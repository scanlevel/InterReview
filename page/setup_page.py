"""Camera and microphone setup page."""

import av
import streamlit as st
from streamlit_webrtc import WebRtcMode, webrtc_streamer


def render_setup_page() -> None:
    """Confirm camera and audio before collecting interview information."""
    st.header("1. 카메라·오디오 설정")
    st.caption("면접 전에 카메라와 마이크 상태를 확인해 주세요.")

    if st.session_state.get("eye_tracker_error"):
        st.error("EyeTracking 모델을 불러오지 못했습니다.")
        st.code(st.session_state["eye_tracker_error"])

    st.session_state["camera_enabled"] = st.checkbox(
        "카메라 사용",
        value=st.session_state.get("camera_enabled", True),
    )
    st.session_state["mic_enabled"] = st.checkbox(
        "마이크 사용",
        value=st.session_state.get("mic_enabled", True),
    )
    st.divider()
    st.subheader("미디어 상태 확인")

    if not st.session_state["camera_enabled"] and not st.session_state["mic_enabled"]:
        st.warning("카메라 또는 마이크 중 하나 이상을 켜 주세요.")
    else:
        def video_frame_callback(frame: av.VideoFrame) -> av.VideoFrame:
            return frame

        webrtc_streamer(
            key="setup-media-check",
            mode=WebRtcMode.SENDRECV,
            media_stream_constraints={
                "video": st.session_state["camera_enabled"],
                "audio": st.session_state["mic_enabled"],
            },
            rtc_configuration={"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]},
            video_frame_callback=video_frame_callback,
            async_processing=True,
        )

    st.divider()
    if st.button("면접 정보 입력", type="primary", width="stretch"):
        if not st.session_state["camera_enabled"]:
            st.error("면접 진행을 위해 카메라를 켜 주세요.")
            return
        if st.session_state.get("eye_tracker") is None:
            st.error("EyeTracking 모델이 준비되지 않았습니다.")
            return
        st.session_state["media_checked"] = True
        st.session_state["recording"] = False
        st.session_state["page"] = "input"
        st.rerun()
