# page/analysis_page.py

import random
import time

import streamlit as st

from module.evaluate import evaluate_interview


def reset_state() -> None:
    st.session_state["profile"] = {}
    st.session_state["questions"] = []
    st.session_state["answers"] = {}
    st.session_state["submitted"] = False
    st.session_state["current_question_index"] = 0
    st.session_state["recording"] = False
    st.session_state["page"] = "input"
    st.session_state["analysis_phase"] = "idle"
    st.session_state["evaluation_result"] = None
    st.session_state["question_features"] = {}
    st.session_state.pop("submitted_data", None)

    if "eye_tracker" in st.session_state:
        st.session_state["eye_tracker"].reset()

    for key in list(st.session_state.keys()):
        if key.startswith("answer_"):
            del st.session_state[key]


def get_fallback_submitted_data() -> dict:
    return {
        "profile": st.session_state["profile"],
        "questions": st.session_state["questions"],
        "answers": st.session_state["answers"],
        "features": st.session_state["question_features"],
    }


def load_submitted_data() -> dict:
    return st.session_state.get("submitted_data", get_fallback_submitted_data())


def render_loading_head() -> None:
    st.header("AI 면접 평가 분석중")
    st.caption("제출된 면접 데이터를 분석하고 있습니다.")

    loading_messages = [
        "답변 데이터를 정리하는 중입니다.",
        "STT 결과를 확인하는 중입니다.",
        "시선 및 태도 feature를 분석하는 중입니다.",
        "질문별 평가 항목을 계산하는 중입니다.",
        "피드백을 생성하는 중입니다.",
    ]

    placeholder = st.empty()

    with st.spinner("분석중입니다..."):
        progress = st.progress(0)

        for index, message in enumerate(loading_messages, start=1):
            placeholder.info(f"🔄 {message}")
            progress.progress(index / len(loading_messages))
            time.sleep(random.uniform(0.4, 0.9))

        submitted_data = load_submitted_data()
        result = evaluate_interview(submitted_data)

        st.session_state["evaluation_result"] = result
        st.session_state["analysis_phase"] = "ready"

    placeholder.success("분석이 완료되었습니다.")
    st.rerun()


def render_result_ready() -> None:
    st.header("평가 완료")
    st.success("AI 면접 평가가 완료되었습니다.")
    st.write("아래 버튼을 눌러 평가 결과를 확인하세요.")

    if st.button("결과 확인하기", use_container_width=True):
        st.session_state["analysis_phase"] = "result"
        st.rerun()


def get_result() -> dict | None:
    result = st.session_state.get("evaluation_result")

    return result


def render_result() -> None:
    st.header("면접 평가 결과")

    result = get_result()

    if result is None:
        st.error("평가 결과가 없습니다.")

        if st.button("처음으로"):
            reset_state()
            st.rerun()

        return

    st.subheader("종합 피드백")
    st.info(result.get("summary_feedback", "종합 피드백이 없습니다."))

    total_score = result.get("total_score")

    if total_score is None:
        st.metric("총점", "평가 예정")
    else:
        st.metric("총점", f"{total_score}점")

    st.divider()

    for index, item in enumerate(result.get("results", []), start=1):
        title = f"질문 {index}. {item.get('category', '')}"

        with st.expander(title, expanded=True):
            st.markdown("#### 질문")
            st.write(item.get("question", ""))

            st.markdown("#### 평가 항목")

            for eval_item in item.get("evaluation_items", []):
                name = eval_item.get("name", "평가 항목")
                score = eval_item.get("score")
                comment = eval_item.get("comment", "")

                if score is None:
                    st.write(f"- **{name}**: 평가 예정")
                else:
                    st.write(f"- **{name}**: {score}점")

                if comment:
                    st.caption(comment)

            st.markdown("#### 피드백")
            st.info(item.get("feedback", "피드백이 없습니다."))

    st.divider()

    with st.expander("제출 JSON 확인", expanded=False):
        st.json(load_submitted_data())

    if st.button("새 면접 시작", use_container_width=True):
        reset_state()
        st.rerun()


def render_analysis_page() -> None:
    phase = st.session_state.get("analysis_phase", "loading")

    if phase == "idle":
        st.session_state["analysis_phase"] = "loading"
        st.rerun()

    if phase == "loading":
        render_loading_head()
        return

    if phase == "ready":
        render_result_ready()
        return

    if phase == "result":
        render_result()
        return

    st.error("알 수 없는 분석 상태입니다.")

    if st.button("처음으로"):
        reset_state()
        st.rerun()
