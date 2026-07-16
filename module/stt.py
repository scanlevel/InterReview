# module/stt.py

def get_stt_status(recording: bool) -> dict:
    """
    STT 상태를 반환한다.
    현재는 실제 마이크/STT 미구현 상태의 더미 함수.
    """
    
    return {
        "recording": recording,
        "speaking": False,
        "duration_sec": 0,
        "duration_text": "00:00",
        "transcript": "",
        "status": "empty",
    }