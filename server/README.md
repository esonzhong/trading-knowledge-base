# Qwen TTS 服务

这个服务给闪卡页面的“AI朗读”按钮使用。API Key 只放在服务器环境变量里，不要写进 HTML、JS 或 GitHub。

## 安装

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell 本地测试：

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 环境变量

必填：

```bash
export DASHSCOPE_API_KEY="你的阿里云百炼API Key"
export DASHSCOPE_WORKSPACE_ID="你的业务空间ID"
```

可选：

```bash
export QWEN_TTS_MODEL="qwen3-tts-flash"
export QWEN_TTS_VOICE="Cherry"
export TTS_ALLOWED_ORIGINS="https://esonzhong.github.io"
```

## 启动

```bash
uvicorn qwen_tts_service:app --host 0.0.0.0 --port 8787
```

确认服务可用：

```bash
curl http://127.0.0.1:8787/health
```

## 网页设置

闪卡页面第一次点击“AI朗读”时，会提示输入服务地址。填：

```text
https://你的域名/tts
```

如果还没有域名和 HTTPS，可以先在本地测试：

```text
http://127.0.0.1:8787/tts
```

正式给 iPhone 使用时建议配置域名和 HTTPS。
