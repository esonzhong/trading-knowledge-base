import os
from typing import Any, Optional, Union

import dashscope
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    deckId: Optional[str] = None
    cardId: Optional[Union[int, str]] = None
    answerOpen: bool = False


def env_list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


app = FastAPI(title="Trading Flashcards Qwen TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=env_list(
        "TTS_ALLOWED_ORIGINS",
        "https://esonzhong.github.io,http://127.0.0.1:8084,http://localhost:8084",
    ),
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


def configure_dashscope() -> str:
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="服务器未配置 DASHSCOPE_API_KEY")
    workspace_id = os.getenv("DASHSCOPE_WORKSPACE_ID")
    if workspace_id:
        dashscope.base_http_api_url = f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1"
    return api_key


def to_plain(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(item) for item in value]
    if hasattr(value, "__dict__"):
        return {key: to_plain(item) for key, item in vars(value).items() if not key.startswith("_")}
    return value


def find_audio_url(value: Any) -> Optional[str]:
    value = to_plain(value)
    if isinstance(value, dict):
        for key in ("audio_url", "audioUrl", "url"):
            item = value.get(key)
            if isinstance(item, str) and item.startswith(("http://", "https://")):
                return item
        for item in value.values():
            found = find_audio_url(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_audio_url(item)
            if found:
                return found
    return None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/tts")
def tts(payload: TtsRequest) -> dict[str, Any]:
    api_key = configure_dashscope()
    try:
        response = dashscope.MultiModalConversation.call(
            model=os.getenv("QWEN_TTS_MODEL", "qwen3-tts-flash"),
            api_key=api_key,
            text=payload.text,
            voice=os.getenv("QWEN_TTS_VOICE", "Cherry"),
            language_type="Chinese",
            stream=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Qwen-TTS 调用失败：{exc}") from exc

    audio_url = find_audio_url(response)
    if not audio_url:
        raise HTTPException(status_code=502, detail="Qwen-TTS 未返回可播放音频地址")
    return {
        "audioUrl": audio_url,
        "deckId": payload.deckId,
        "cardId": payload.cardId,
        "answerOpen": payload.answerOpen,
    }
