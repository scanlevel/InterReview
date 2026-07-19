# page/interview_page.py

import av
import streamlit as st
from streamlit_webrtc import WebRtcMode, webrtc_streamer

from module.stt import get_audio_buffer, get_stt_status, transcribe_wav


def render_virtual_interviewer(question: dict) -> None:
    st.markdown("### 가상 면접관")
    st.markdown(
        f"""
        <div style="
            min-height: 340px;
            border: 2px solid #444;
            border-radius: 14px;
            padding: 24px;
            background-color: #111;
            color: white;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
        ">
            <div style="font-size: 56px;">👤</div>
            <div style="font-size: 20px; margin-top: 8px;">
                가상 면접관
            </div>
            <div style="
                font-size: 16px;
                margin-top: 28px;
                line-height: 1.7;
                word-break: keep-all;
            ">
                {question["text"]}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_candidate_camera() -> None:
    st.markdown("### 지원자 화면")

    eye_tracker = st.session_state.get("eye_tracker")

    if eye_tracker is None:
        st.error("EyeTracking 모듈이 초기화되지 않았습니다.")
        if st.session_state.get("eye_tracker_error"):
            st.code(st.session_state["eye_tracker_error"])
        return

    audio_buffer = get_audio_buffer()
    mic_enabled = st.session_state.get("mic_enabled", True)

    def video_frame_callback(frame: av.VideoFrame) -> av.VideoFrame:
        image = frame.to_ndarray(format="bgr24")

        annotated_image, _ = eye_tracker.process_bgr_frame(image)

        return av.VideoFrame.from_ndarray(
            annotated_image,
            format="bgr24",
        )

    def audio_frame_callback(frame: av.AudioFrame) -> av.AudioFrame:
        # Runs in the webrtc worker thread; only touch the buffer object here.
        audio_buffer.add_frame(frame)
        return frame

    ctx = webrtc_streamer(
        key="candidate-camera",
        mode=WebRtcMode.SENDRECV,
        media_stream_constraints={
            "video": True,
            "audio": mic_enabled,
        },
        rtc_configuration={
            "iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]
        },
        video_frame_callback=video_frame_callback,
        audio_frame_callback=audio_frame_callback if mic_enabled else None,
        async_processing=True,
    )

    playing = bool(ctx.state.playing)
    if playing:
        st.caption("🟢 스트림 재생 중 (카메라·마이크 연결됨)")
    else:
        st.warning(
            "🔴 스트림이 재생되지 않았습니다. 위 영상 영역의 **START** 버튼을 누르고 "
            "카메라·마이크 권한을 허용해 주세요. (녹음은 스트림이 재생돼야 동작합니다.)"
        )

    if not mic_enabled:
        st.caption("마이크가 꺼져 있어 답변 음성이 기록되지 않습니다.")


def _render_stt_panel_body() -> None:
    audio_buffer = get_audio_buffer()
    stt_status = get_stt_status(audio_buffer)

    st.subheader("STT 상태")

    col1, col2, col3 = st.columns(3)

    with col1:
        if stt_status["recording"]:
            st.success("🔴 녹음중입니다")
        elif stt_status["status"] == "buffered":
            st.info("녹음 완료")
        else:
            st.warning("대기중입니다")

    with col2:
        st.metric("버퍼 샘플", f"{stt_status['buffered_samples']:,}")

    with col3:
        st.metric("녹음 시간", stt_status["duration_text"])

    mic_enabled = st.session_state.get("mic_enabled", True)
    frames_seen = stt_status.get("frames_seen", 0)
    st.caption(
        f"진단 · 마이크 사용={mic_enabled} · 콜백 수신 프레임(총)={frames_seen} · "
        f"리샘플 오류={stt_status.get('resample_errors', 0)}"
    )
    if stt_status["recording"] and stt_status["buffered_samples"] == 0:
        if not mic_enabled:
            st.error("설정에서 마이크가 꺼져 있어 오디오가 기록되지 않습니다.")
        elif frames_seen == 0:
            st.warning(
                "마이크 오디오 트랙이 서버에 도달하지 않았습니다. "
                "브라우저 마이크 권한 허용 여부와 카메라 위젯의 재생 상태를 확인해 주세요."
            )
        else:
            st.info("오디오 프레임은 수신 중입니다. 발화가 감지되면 버퍼가 쌓입니다.")

    current_index = st.session_state["current_question_index"]
    current_question = st.session_state["questions"][current_index]
    transcript = st.session_state["answers"].get(current_question["id"], "")
    if transcript:
        st.caption("최근 변환된 답변")
        st.write(transcript)

    with st.expander("STT Feature JSON", expanded=False):
        st.json(stt_status)


if hasattr(st, "fragment"):
    render_stt_panel = st.fragment(run_every="1s")(_render_stt_panel_body)
else:
    def render_stt_panel() -> None:
        _render_stt_panel_body()


def _render_vision_panel_body() -> None:
    eye_tracker = st.session_state.get("eye_tracker")

    st.subheader("실시간 CAM 분석 상태")

    if eye_tracker is None:
        st.error("EyeTracking 모듈이 없습니다.")
        return

    eye_status = eye_tracker.snapshot()

    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric(
            "처리 프레임",
            eye_status["processed_frames"],
        )

    with col2:
        st.metric(
            "얼굴 검출 비율",
            f"{eye_status['face_detected_ratio']:.2f}",
        )

    with col3:
        st.metric(
            "정면 응시 추정",
            f"{eye_status['front_gaze_ratio']:.2f}",
        )

    with st.expander("Eye Tracking Feature JSON", expanded=False):
        st.json(eye_status)


if hasattr(st, "fragment"):
    render_vision_panel = st.fragment(run_every="1s")(_render_vision_panel_body)
else:
    def render_vision_panel() -> None:
        _render_vision_panel_body()


def save_current_features(question_id: str) -> None:
    audio_buffer = get_audio_buffer()
    audio_buffer.stop()

    wav_bytes = audio_buffer.to_wav_bytes()
    if wav_bytes:
        with st.spinner("답변을 텍스트로 변환하는 중입니다..."):
            stt_result = transcribe_wav(wav_bytes)
    else:
        stt_result = {"transcript": "", "status": "empty", "error": None}

    eye_tracker = st.session_state.get("eye_tracker")

    if eye_tracker is None:
        eye_status = {
            "status": "eye_tracker_not_available"
        }
    else:
        eye_status = eye_tracker.snapshot()

    st.session_state["answers"][question_id] = stt_result.get("transcript", "")

    st.session_state["question_features"][question_id] = {
        "stt": stt_result,
        "eye_tracking": eye_status,
    }


def move_to_question(
    next_index: int,
    current_question_id: str,
) -> None:
    save_current_features(current_question_id)

    st.session_state["current_question_index"] = next_index
    st.session_state["recording"] = False

    get_audio_buffer().reset()

    eye_tracker = st.session_state.get("eye_tracker")
    if eye_tracker is not None:
        eye_tracker.reset()

    st.rerun()


def has_missing_answers() -> bool:
    return False


def finish_interview(question_id: str) -> None:
    save_current_features(question_id)

    if has_missing_answers():
        st.error("답변이 누락된 질문이 있습니다.")
        return

    # Keep applicant data in the browser session.  Writing it to the server
    # would expose one user's interview content to other users on a shared
    # deployment and is not durable on most app hosts anyway.
    st.session_state["submitted_data"] = {
        "profile": st.session_state["profile"],
        "questions": st.session_state["questions"],
        "answers": st.session_state["answers"],
        "features": st.session_state["question_features"],
    }

    st.session_state["recording"] = False
    st.session_state["submitted"] = True
    st.session_state["analysis_phase"] = "loading"
    st.session_state["page"] = "analysis"

    st.rerun()


def render_interview_page() -> None:
    if not st.session_state.get("media_checked"):
        st.warning("면접 시작 전 카메라 / 마이크 설정을 먼저 확인해 주세요.")

        if st.button("설정 화면으로 이동", use_container_width=True):
            st.session_state["page"] = "setup"
            st.rerun()

        return

    questions = st.session_state["questions"]

    if not questions:
        st.warning("생성된 질문이 없습니다. 면접 정보를 먼저 입력해 주세요.")

        if st.button("입력 화면으로 돌아가기"):
            st.session_state["page"] = "input"
            st.rerun()

        return

    current_index = st.session_state["current_question_index"]
    current_question = questions[current_index]
    question_id = current_question["id"]

    st.header("4. 모의면접 진행")

    st.progress((current_index + 1) / len(questions))
    st.caption(f"질문 {current_index + 1} / {len(questions)}")

    left, right = st.columns(2)

    with left:
        render_virtual_interviewer(current_question)

    with right:
        render_candidate_camera()

    st.divider()

    panel_left, panel_right = st.columns(2)

    with panel_left:
        render_stt_panel()

    with panel_right:
        render_vision_panel()

    st.divider()

    col_prev, col_record, col_next = st.columns(3)

    with col_prev:
        if current_index > 0:
            if st.button("이전 질문", use_container_width=True):
                move_to_question(
                    current_index - 1,
                    question_id,
                )
        else:
            st.button(
                "이전 질문",
                disabled=True,
                use_container_width=True,
            )

    with col_record:
        if st.session_state["recording"]:
            if st.button("녹음 중지", use_container_width=True):
                st.session_state["recording"] = False
                save_current_features(question_id)
                st.rerun()
        else:
            if st.button("녹음 시작", use_container_width=True):
                get_audio_buffer().start()
                st.session_state["recording"] = True
                st.rerun()

    with col_next:
        is_last_question = current_index == len(questions) - 1

        if not is_last_question:
            if st.button("다음 질문", use_container_width=True):
                move_to_question(
                    current_index + 1,
                    question_id,
                )
        else:
            if st.button("면접 종료", use_container_width=True):
                finish_interview(question_id)
