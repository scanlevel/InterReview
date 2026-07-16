# app.py

import streamlit as st

from module.eyetracking import EyeTracker
from page.input_page import render_input_page
from page.setup_page import render_setup_page
from page.generation_page import render_generation_page
from page.interview_page import render_interview_page
from page.analysis_page import render_analysis_page


def init_state() -> None:
    defaults = {
        "profile": {},
        "questions": [],
        "answers": {},
        "submitted": False,
        "current_question_index": 0,
        "recording": False,
        "page": "setup",
        "analysis_phase": "idle",
        "evaluation_result": None,
        "question_features": {},
        "camera_enabled": True,
        "mic_enabled": True,
        "media_checked": False,
        "eye_tracker_error": None,
        "generation_status": "idle",
        "generation_error": None,
        "generation_personalization": None,
        "generation_personalized_count": 0,
        "submitted_data": None,
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    if "eye_tracker" not in st.session_state:
        try:
            st.session_state["eye_tracker"] = EyeTracker()
            st.session_state["eye_tracker_error"] = None
        except Exception as error:
            st.session_state["eye_tracker"] = None
            st.session_state["eye_tracker_error"] = str(error)


def main() -> None:
    st.set_page_config(
        page_title="InterReview MVP",
        layout="centered",
    )

    init_state()

    st.title("InterReview MVP")
    st.caption("가상 면접관 · 지원자 CAM · STT 상태 기반 모의면접")

    page = st.session_state["page"]

    if page == "input":
        render_input_page()
        return

    if page == "setup":
        render_setup_page()
        return

    if page == "generating":
        render_generation_page()
        return

    if page == "interview":
        render_interview_page()
        return

    if page == "analysis":
        render_analysis_page()
        return

    st.error("알 수 없는 화면 상태입니다.")

    if st.button("초기화"):
        st.session_state["page"] = "input"
        st.rerun()


if __name__ == "__main__":
    main()
