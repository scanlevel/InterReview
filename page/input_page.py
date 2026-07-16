"""Interview profile input page."""

import streamlit as st


def render_input_page() -> None:
    """Collect profile data, then transition to the dedicated generation page."""
    st.header("2. 면접 정보 입력")
    st.caption("입력한 정보를 바탕으로 질문은행에서 여섯 개의 질문을 선택하고 개인화합니다.")

    with st.form("profile_form"):
        experience = st.segmented_control(
            "경력 구분",
            options=["NEW", "EXPERIENCED"],
            default="NEW",
            required=True,
            format_func=lambda value: "신입" if value == "NEW" else "경력",
            width="stretch",
        )
        interview_topic = st.text_input("면접 주제")
        job_role = st.text_input("지원 직무")
        tech_stack = st.text_input("기술 스택")
        project_experience = st.text_area("프로젝트 경험")
        collaboration_experience = st.text_area("협업 경험")
        self_intro = st.text_area("자기소개")
        profile_submitted = st.form_submit_button("질문 생성", type="primary", width="stretch")

    if not profile_submitted:
        return

    profile = {
        "experience": experience,
        "interview_topic": interview_topic.strip(),
        "job_role": job_role.strip(),
        "tech_stack": tech_stack.strip(),
        "project_experience": project_experience.strip(),
        "collaboration_experience": collaboration_experience.strip(),
        "self_intro": self_intro.strip(),
    }
    if any(not value for value in profile.values()):
        st.error("모든 항목을 입력해 주세요.")
        return

    st.session_state["profile"] = profile
    st.session_state["questions"] = []
    st.session_state["answers"] = {}
    st.session_state["submitted"] = False
    st.session_state["current_question_index"] = 0
    st.session_state["recording"] = False
    st.session_state["question_features"] = {}
    st.session_state["evaluation_result"] = None
    st.session_state["analysis_phase"] = "idle"
    st.session_state["generation_status"] = "pending"
    st.session_state["generation_error"] = None
    st.session_state["generation_personalization"] = None
    st.session_state["generation_personalized_count"] = 0
    st.session_state["page"] = "generating"
    st.rerun()
