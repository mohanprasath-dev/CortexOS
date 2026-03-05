# 🧠 CortexOS – Real-Time Multimodal Autonomous Workspace Agent

<p align="center">
  <strong>A production-ready AI agent that sees your screen, hears your voice, and takes action in a sandboxed browser — powered by Gemini Live API on Google Cloud.</strong>
</p>

---

## 📖 Overview

CortexOS is a real-time multimodal autonomous workspace agent built for the **Gemini Live Agent Challenge**. It streams live microphone audio and periodic screen captures to the **Gemini 2.0 Flash Live API** via Vertex AI, receives structured tool calls, and executes browser actions using **Playwright** — all in real time.

This is **not** a chatbot. CortexOS demonstrates:

- **Real-time multimodal interaction** — voice + vision + action loop
- **Autonomous task execution** — Gemini decides and acts
- **Structured tool-based reasoning** — validated JSON tool calls, not free-text
- **Full observability** — action trace UI shows every decision and result

---

## 🏗️ Architecture

```
Frontend (React)          Backend (Node.js)              Google Cloud
┌─────────────┐    WS    ┌──────────────────┐    WS    ┌──────────────┐
│ 🎤 Mic      │◄────────►│ Express Server   │◄────────►│ Vertex AI    │
│ 🖥️ Screen   │          │ Session Manager  │          │ Gemini 2.0   │
│ 📊 Trace UI │          │                  │          │ Flash Live   │
└─────────────┘          │ ┌──────────────┐ │          └──────────────┘
                         │ │Tool Executor │ │
                         │ └──────┬───────┘ │          ┌──────────────┐
                         │        │         │          │ Cloud Run    │
                         │ ┌──────▼───────┐ │◄─────────│ (Deployment) │
                         │ │ Playwright   │ │          └──────────────┘
                         │ │ (Chromium)   │ │
                         │ └──────────────┘ │
                         └──────────────────┘
```

See [architecture.mmd](architecture.mmd) for the full Mermaid diagram.
> **Tip:** You can render it with the [Mermaid Live Editor](https://mermaid.live) or any Mermaid-compatible viewer.

### Data Flow

1. **Mic stream** → Frontend captures 16kHz PCM16 audio → WebSocket → Backend → Gemini Live
2. **Screen capture** → Frontend grabs frames every 2.5s → compress to JPEG → Backend → Gemini Live
3. **Gemini responds** with text/audio OR structured tool calls
4. **Tool Executor** validates and dispatches tool calls to Playwright
5. **Playwright** executes browser actions (navigate, click, type, extract)
6. **Results** flow back to Gemini for continued reasoning
7. **Action Trace** UI shows the full reasoning + action chain

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript, WebRTC, Screen Capture API |
| **Backend** | Node.js 20+, Express, WebSocket (ws), TypeScript |
| **AI** | Gemini 2.0 Flash Live via Vertex AI (streaming WebSocket) |
| **Browser Automation** | Playwright (Chromium, headless) |
| **Image Processing** | Sharp (resize + JPEG compression) |
| **Deployment** | Docker, Google Cloud Run |
| **Logging** | Winston |

---

## 📂 Project Structure

```
cortexos/
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # Main UI (controls, demo mode, collapsible trace)
│   │   ├── main.tsx                 # React entry point (wraps with ErrorBoundary)
│   │   ├── mic.ts                   # Microphone capture (16kHz PCM16)
│   │   ├── screenCapture.ts         # Screen capture (JPEG compression)
│   │   ├── websocket.ts             # WebSocket client with reconnection
│   │   └── components/
│   │       ├── ActionTrace.tsx       # Real-time action trace panel
│   │       └── ErrorBoundary.tsx     # React error boundary with retry
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── server.ts                # Express + WebSocket server (backpressure, profiling)
│   │   ├── geminiLiveClient.ts      # Vertex AI BidiGenerateContent client (OAuth2)
│   │   ├── toolSchema.ts            # Tool declarations + validation
│   │   ├── toolExecutor.ts          # Tool dispatch with retry + safety
│   │   ├── playwrightController.ts  # Sandboxed browser control
│   │   ├── sessionMemory.ts         # In-memory action log
│   │   └── logger.ts                # Winston structured logging
│   ├── tsconfig.json
│   ├── package.json
│   └── .env.example
│
├── docker/
│   ├── Dockerfile                   # Multi-stage production build (non-root)
│   └── .dockerignore
│
├── architecture.mmd                 # Mermaid architecture diagram
├── .gitignore
└── README.md
```

---

## 🚀 Setup Guide

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **Google Cloud account** with billing enabled
- **gcloud CLI** ([install](https://cloud.google.com/sdk/docs/install))
- **Docker** (for deployment)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/cortexos.git
cd cortexos
```

### 2. Enable Google Cloud APIs

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### 3. Create Service Account

```bash
# Create service account
gcloud iam service-accounts create cortexos-agent \
  --display-name="CortexOS Agent"

# Grant Vertex AI permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:cortexos-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Download key
gcloud iam service-accounts keys create ./service-account-key.json \
  --iam-account=cortexos-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 4. Configure Environment

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

```env
PROJECT_ID=your-gcp-project-id
LOCATION=us-central1
GEMINI_MODEL_NAME=gemini-2.0-flash-live-001
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
PORT=8080
```

### 5. Install Dependencies

```bash
# Backend
cd backend
npm install
npx playwright install chromium

# Frontend
cd ../frontend
npm install
```

### 6. Run Locally

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 🌩️ Deployment (Google Cloud Run)

### Build Docker Image

```bash
# From the cortexos/ root directory
docker build -f docker/Dockerfile -t cortexos .
```

### Push to Google Container Registry

```bash
# Tag the image
docker tag cortexos gcr.io/YOUR_PROJECT_ID/cortexos:latest

# Push
docker push gcr.io/YOUR_PROJECT_ID/cortexos:latest
```

### Deploy to Cloud Run

```bash
gcloud run deploy cortexos \
  --image gcr.io/YOUR_PROJECT_ID/cortexos:latest \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --allow-unauthenticated \
  --set-env-vars "PROJECT_ID=YOUR_PROJECT_ID,LOCATION=us-central1,GEMINI_MODEL_NAME=gemini-2.0-flash-live-001" \
  --port 8080
```

### Environment Variables for Cloud Run

| Variable | Description | Required |
|----------|------------|----------|
| `PROJECT_ID` | Google Cloud project ID | Yes |
| `LOCATION` | Vertex AI region (e.g., `us-central1`) | Yes |
| `GEMINI_MODEL_NAME` | Model name (e.g., `gemini-2.0-flash-live-001`) | Yes |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account key | Yes (local) |
| `PORT` | HTTP + WebSocket server port | No (default: 8080) |

> **Note:** On Cloud Run, authentication is handled automatically via the service account attached to the Cloud Run service. You don't need `GOOGLE_APPLICATION_CREDENTIALS` in production.

---

## 🎬 Demo Script

### Demo 1: Developer Flow – "Fix the Error"

1. Connect to CortexOS
2. Navigate the Playwright browser to a code editor or terminal view
3. Say or type: **"Fix the error."**
4. Watch CortexOS:
   - Extract text from the screen (reads the terminal error)
   - Analyze the error and explain it
   - Navigate to the relevant file
   - Type the corrected code
   - Report completion

### Demo 2: Business Flow – "Summarize and Email"

1. Navigate to a document page
2. Say or type: **"Summarize this document and email it."**
3. Watch CortexOS:
   - Extract the document text
   - Summarize the content
   - Navigate to email client
   - Type the summary into a new email
   - Click send

### Demo 3: Scheduling Flow – "Create a Meeting"

1. Say or type: **"Create a meeting tomorrow at 4 PM."**
2. Watch CortexOS:
   - Open Google Calendar
   - Fill in the event form with date, time, and title
   - Confirm the event creation

### Running Demo Scenarios

Toggle **Demo Mode** (header toggle) for auto-send demo buttons:
- 🔧 **Developer Fix** — "Fix the error shown in the terminal"
- 📄 **Summarize & Email** — "Summarize this document and email it"
- 📅 **Schedule Meeting** — "Create a meeting tomorrow at 4 PM"

With Demo Mode **ON**, clicking a demo button immediately sends the command. With Demo Mode **OFF**, it pre-fills the text input for review.

---

## 🛡️ Safety Constraints

| Constraint | Implementation |
|-----------|---------------|
| No medical advice | Content filter blocks medical/diagnostic queries |
| No legal advice | Content filter blocks legal advisory content |
| No harmful automation | URL safety filter blocks `file://`, `javascript:`, `chrome://` |
| No OS-level access | All actions confined to Playwright browser sandbox |
| Rate limiting | Max 30 actions per minute per session |
| Execution timeout | 10-second timeout on all tool executions |
| Input validation | All tool arguments validated against schema before execution |

---

## ⚡ Performance

| Metric | Target | Implementation |
|--------|--------|---------------|
| Screen capture interval | 2–3 seconds | Configurable, default 2.5s |
| Image size | Minimal | Resized to max 1024px, JPEG quality 60% |
| Response latency | <2 seconds | Streaming responses, compressed payloads |
| Audio format | Efficient | 16kHz PCM16 mono (Gemini native format) |
| Memory | Bounded | Session memory capped at 500 entries with auto-pruning |

---

## 📊 Tool Schema

CortexOS exposes six structured tools to Gemini:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `navigate` | `url: string` | Navigate browser to a URL |
| `click` | `selector: string` | Click an element by CSS selector |
| `type` | `selector: string, text: string` | Type text into an input field |
| `extract` | `selector: string` | Extract text content from an element |
| `summarize` | `text: string` | Summarize a block of text |
| `create_calendar_event` | `date: string, time: string, title: string` | Create a calendar event |

All tool calls are:
- **Validated** against the schema before execution
- **Logged** in session memory for traceability
- **Retried** up to 2 times on transient failures
- **Timed out** after 10 seconds

---

## ✅ Hackathon Compliance

| Requirement | Status | Details |
|------------|--------|---------|
| Uses Gemini Live API (streaming) | ✅ | BidiGenerateContent WebSocket via Vertex AI |
| Uses Google Cloud (Cloud Run + Vertex AI) | ✅ | Dockerfile + Cloud Run + OAuth2 (no API keys) |
| Original work | ✅ | Built from scratch |
| Real-time multimodal interaction | ✅ | Voice + vision + action loop |
| Deployment configuration included | ✅ | Dockerfile, Cloud Run commands |
| Architecture diagram | ✅ | Mermaid diagram in `architecture.mmd` |
| Demo-ready flows | ✅ | Three scripted scenarios + Demo Mode toggle |
| No medical/diagnostic advice | ✅ | Content safety filters |
| Not a prompt wrapper | ✅ | Autonomous tool execution agent |
| Public GitHub-ready | ✅ | Clean structure, `.gitignore`, README |
| Error handling | ✅ | ErrorBoundary, unhandled rejection guard, retry logic |
| Observability | ✅ | Profiling logs, action trace, session memory |

---

## 📜 License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built for the <strong>Gemini Live Agent Challenge</strong><br/>
  Powered by <strong>Gemini 2.0 Flash Live</strong> on <strong>Google Cloud Vertex AI</strong>
</p>
