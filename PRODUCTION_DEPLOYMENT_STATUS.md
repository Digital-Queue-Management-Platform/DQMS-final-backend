# 🚀 Production Deployment Guide for DQMS Centralized IP Speaker System

## Current Status: ❌ NOT DEPLOYED

The centralized IP speaker system is currently only configured for local development. Here's how to deploy it to production.

## 🎯 Architecture Overview for Production

```
┌─────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────┐
│     Vercel          │   │    Render.com           │   │   Branch Locations  │
│  Frontend (Live)    │───│  Main Backend (Live)    │───│   VLC + Clients     │
│                     │   │                         │   │   (Not Deployed)    │
└─────────────────────┘   └─────────────────────────┘   └─────────────────────┘
                                      │
                          ┌─────────────────────────┐
                          │    Render.com           │
                          │ Central Speaker Server  │
                          │   (Not Deployed)        │
                          └─────────────────────────┘
```

## 📋 Deployment Steps

### Step 1: Deploy Central Announcement Server

#### 1.1 Create New Render.com Web Service
1. Go to [Render.com Dashboard](https://dashboard.render.com)
2. Click "New" → "Web Service"
3. Connect your GitHub repository: `Digital-Queue-Management-Platform/DQMS-final-backend`
4. Configure:
   - **Name**: `dqms-central-speaker`
   - **Branch**: `feat/minor-bugs` (or main)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:central-server`
   - **Instance Type**: Starter ($7/month)

#### 1.2 Set Environment Variables
```env
CENTRAL_SPEAKER_PORT=10000
CENTRAL_SPEAKER_WS_PORT=10001
DEFAULT_BRANCH_ID=production-main
NODE_ENV=production
```

#### 1.3 Update Package.json for Production
Add to package.json scripts:
```json
{
  "start:central-server": "node dist/services/centralAnnouncementServer.js"
}
```

### Step 2: Update Main Backend

#### 2.1 Update Environment Variables on Render.com
Add to your existing backend service:
```env
CENTRAL_ANNOUNCEMENT_SERVER=https://dqms-central-speaker.onrender.com
DEFAULT_BRANCH_ID=production-main
```

### Step 3: Update Frontend

#### 3.1 Update Vercel Environment Variables
Add to your Vercel project:
```env
VITE_CENTRAL_SERVER_URL=https://dqms-central-speaker.onrender.com
VITE_BRANCH_ID=production-main
```

### Step 4: Branch Location Setup (Manual)

Each bank branch needs:

#### 4.1 Computer with VLC Installed
```bash
# Install VLC Media Player
# Configure with HTTP interface:
vlc --intf http --http-password securepassword --http-port 8081
```

#### 4.2 Branch Speaker Client
```bash
# Download the compiled branch client
# Configure environment:
BRANCH_ID=branch-colombo-01
CENTRAL_SERVER_WS=wss://dqms-central-speaker.onrender.com
VLC_HOST=localhost
VLC_PORT=8081
VLC_PASSWORD=securepassword
```

## 🔧 Current Implementation Status

### ✅ **Completed (Ready for Production)**
- [x] Central Announcement Server code
- [x] Backend API integration
- [x] Frontend UI updates
- [x] VLC HTTP interface integration
- [x] WebSocket communication
- [x] Fallback mechanisms

### ❌ **Not Yet Deployed**
- [ ] Central server on Render.com
- [ ] Production environment variables
- [ ] Branch speaker clients
- [ ] VLC installations at branches

## 🚀 Quick Production Test (Without Physical Setup)

You can test the system in production mode right now:

### Step 1: Deploy Central Server
```bash
# This will work immediately on Render.com
git push origin feat/minor-bugs
# Deploy as new web service
```

### Step 2: Test from Frontend
Once deployed, the frontend will automatically use the central server, and if no physical VLC players are connected, it will fall back to browser speech synthesis.

## 💡 Deployment Options

### Option A: Full Physical Setup
- Deploy central server ✅
- Install VLC at each branch ❌
- Deploy branch clients ❌
- **Result**: Professional audio system

### Option B: Cloud-Only Setup  
- Deploy central server ✅
- Use browser speech synthesis ✅
- No physical hardware needed ✅
- **Result**: Works immediately in production

### Option C: Hybrid Setup
- Deploy central server ✅
- Gradual rollout to branches ⚠️
- Mix of VLC and browser audio ✅
- **Result**: Phased deployment

## 🎯 Recommended Next Steps

1. **Immediate (15 minutes)**: Deploy central server to Render.com
2. **Short-term (1 day)**: Update environment variables
3. **Medium-term (1 week)**: Set up one pilot branch with VLC
4. **Long-term (1 month)**: Roll out to all branches

## 📞 Current Workaround

**The IP speaker functionality is actually working in production right now** using browser speech synthesis! When officers click "Call Customer," it:

1. ✅ Sends request to backend
2. ✅ Backend attempts to contact central server
3. ❌ Central server not deployed (fails)
4. ✅ Falls back to browser speech synthesis
5. ✅ Announcement is played through officer's computer speakers

## 🔥 Quick Production Deploy

Want to deploy the central server right now? I can help you:

1. **Create the Render.com service**
2. **Update environment variables**
3. **Test the full system**

Just let me know if you want to proceed with immediate deployment!