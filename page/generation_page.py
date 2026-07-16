"""Question generation progress page."""

from __future__ import annotations

import streamlit as st

from module.question_generator import generate_questions


def render_generation_page() -> None:
    """Generate questions once and show model progress before interview entry."""
    st.header("3. 맞춤 면접 질문 생성")
    st.caption("질문은행 선택과 Kanana 개인화 단계를 차례로 진행합니다.")

    status = st.session_state.get("generation_status", "idle")
    if status == "idle":
        st.session_state["page"] = "input"
        st.rerun()

    if status == "pending":
        progress_bar = st.progress(0, text="질문 생성을 준비하는 중입니다.")
        detail = st.empty()

        def update_progress(message: str, value: float) -> None:
            percent = int(max(0.0, min(1.0, value)) * 100)
            progress_bar.progress(percent, text=message)
            detail.caption(message)

        try:
            questions = generate_questions(st.session_state["profile"], progress_callback=update_progress)
            st.session_state["questions"] = questions
            personalized_count = sum(question.get("personalization") == "kanana" for question in questions)
            st.session_state["generation_personalization"] = (
                "kanana" if personalized_count == len(questions) else "partial" if personalized_count else "fallback"
            )
            st.session_state["generation_personalized_count"] = personalized_count
            st.session_state["generation_status"] = "completed"
            update_progress(f"{len(questions)}개 질문 생성이 완료되었습니다.", 1.0)
        except Exception as error:
            st.session_state["generation_status"] = "failed"
            st.session_state["generation_error"] = str(error)
            progress_bar.empty()
        st.rerun()

    if st.session_state["generation_status"] == "failed":
        st.error("질문 생성 중 오류가 발생했습니다.")
        st.code(st.session_state.get("generation_error", "알 수 없는 오류"))
        if st.button("면접 정보 다시 입력", width="stretch"):
            st.session_state["generation_status"] = "idle"
            st.session_state["page"] = "input"
            st.rerun()
        return

    questions = st.session_state.get("questions", [])
    if not questions:
        st.warning("생성된 질문이 없습니다.")
        return

    st.success("질문 생성이 완료되었습니다!")
    if st.session_state.get("generation_personalization") == "kanana":
        st.info("Kanana가 입력한 면접 정보를 반영해 질문을 개인화했습니다.")
    elif st.session_state.get("generation_personalization") == "partial":
        st.warning(
            f"Kanana가 {st.session_state.get('generation_personalized_count', 0)}개 질문을 개인화했습니다. "
            "나머지는 질문은행 원문을 사용합니다."
        )
    else:
        st.warning("Kanana 개인화를 사용할 수 없어 질문은행 원문으로 생성했습니다.")

    for index, question in enumerate(questions, start=1):
        personalization_label = ":green[개인화 완료]" if question.get("personalization") == "kanana" else ":orange[질문은행 원문]"
        with st.container(horizontal=True, horizontal_alignment="distribute"):
            st.caption(f"{index}번 · {question['category']}")
            st.caption(personalization_label)

    if st.button("면접 시작하기", type="primary", width="stretch"):
        st.session_state["current_question_index"] = 0
        st.session_state["recording"] = True
        eye_tracker = st.session_state.get("eye_tracker")
        if eye_tracker is not None:
            eye_tracker.reset()
        st.session_state["page"] = "interview"
        st.rerun()
