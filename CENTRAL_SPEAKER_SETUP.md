# DQMS Centralized IP Speaker System with VLC Integration

This system provides a centralized announcement server for Sri Lanka that integrates with VLC player via HTTP interface for audio playback.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────────────┐    ┌─────────────────┐
│   Officer UI    │    │   Central Announcement   │    │  Branch Speaker │
│   (Frontend)    │────│       Server             │────│     Client      │
│                 │    │   (Sri Lanka Central)    │    │   + VLC Player  │
└─────────────────┘    └──────────────────────────┘    └─────────────────┘
                                    │                           │
                       ┌────────────┴────────────┐             │
                       │                         │             │
              ┌─────────────────┐      ┌─────────────────┐     │
              │   Branch A      │      │   Branch B      │     │
              │  Speaker Client │      │  Speaker Client │     │
              │  + VLC Player   │      │  + VLC Player   │     │
              └─────────────────┘      └─────────────────┘     │
                                                               │
                                                    ┌─────────────────┐
                                                    │   Branch N      │
                                                    │  Speaker Client │
                                                    │  + VLC Player   │
                                                    └─────────────────┘
```

## Components

### 1. Central Announcement Server
- **Location**: `src/services/centralAnnouncementServer.ts`
- **Purpose**: Central hub for all announcements in Sri Lanka
- **Features**:
  - WebSocket connections for real-time communication
  - VLC HTTP interface integration
  - Text-to-Speech generation
  - Branch management
  - Health monitoring

### 2. Updated Backend Routes
- **Location**: `src/routes/ip-speaker.routes.ts`
- **Purpose**: Route announcements through central server
- **Features**:
  - Central server integration
  - Legacy IP speaker fallback
  - Connection testing
  - Branch management endpoints

### 3. Branch Speaker Client
- **Location**: `src/services/branchSpeakerClient.ts`
- **Purpose**: Connects each branch to central server
- **Features**:
  - WebSocket connection to central server
  - VLC HTTP interface control
  - Automatic reconnection
  - Heartbeat monitoring

### 4. Updated Frontend Components
- **Location**: `src/components/IPSpeaker.tsx`
- **Purpose**: Officer interface with central server integration
- **Features**:
  - Central server communication
  - Connection status display
  - Fallback to browser speech
  - Multi-language support

## Setup Instructions

### 1. Install Dependencies

#### Backend Dependencies
```bash
cd DQMS-final-backend
npm install ws @types/ws
```

#### VLC Player Setup
1. Download and install VLC Media Player
2. Enable HTTP interface:
   ```bash
   # Windows
   vlc --intf http --http-password vlcpassword --http-port 8081

   # Linux/Mac
   vlc --intf http --http-password vlcpassword --http-port 8081
   ```

### 2. Environment Configuration

#### Backend `.env`
```env
# Central Announcement Server Configuration
CENTRAL_ANNOUNCEMENT_SERVER=http://localhost:3002
CENTRAL_SPEAKER_PORT=3002
CENTRAL_SPEAKER_WS_PORT=8080
DEFAULT_BRANCH_ID=main-branch

# VLC Configuration
VLC_HOST=localhost
VLC_PORT=8081
VLC_PASSWORD=vlcpassword
```

#### Frontend `.env`
```env
# Central Server Configuration
VITE_CENTRAL_SERVER_URL=http://localhost:3002
VITE_BRANCH_ID=main-branch

# VLC Configuration
VITE_VLC_HOST=localhost
VITE_VLC_PORT=8081
VITE_VLC_PASSWORD=vlcpassword
```

### 3. Running the System

#### Step 1: Start VLC with HTTP Interface
```bash
vlc --intf http --http-password vlcpassword --http-port 8081
```

#### Step 2: Start Central Announcement Server
```bash
cd DQMS-final-backend
npm run dev:central-server
```

#### Step 3: Start Branch Speaker Client
```bash
cd DQMS-final-backend
npm run dev:branch-client
```

#### Step 4: Start Main Backend Server
```bash
cd DQMS-final-backend
npm run dev
```

#### Step 5: Start Frontend
```bash
cd DQMS-final-frontend
npm run dev
```

## Testing the System

### 1. Test VLC Connection
```bash
# Test VLC HTTP interface
curl -u :vlcpassword "http://localhost:8081/requests/status.json"
```

### 2. Test Central Server Health
```bash
curl http://localhost:3002/api/health
```

### 3. Test Announcement
```bash
curl -X POST http://localhost:3002/api/announce \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "main-branch",
    "text": "Token number 123, please proceed to counter 5",
    "language": "en",
    "volume": 80,
    "tokenNumber": 123
  }'
```

### 4. Test via Backend API
```bash
curl -X POST http://localhost:3001/api/ip-speaker/announce \
  -H "Content-Type: application/json" \
  -d '{
    "branchId": "main-branch",
    "text": "Token number 456, please proceed to counter 3",
    "language": "en",
    "volume": 80,
    "tokenNumber": 456
  }'
```

## VLC HTTP Interface Commands

### Basic Commands
- **Get Status**: `GET /requests/status.json`
- **Play File**: `GET /requests/status.json?command=in_play&input=<file_url>`
- **Set Volume**: `GET /requests/status.json?command=volume&val=<0-512>`
- **Stop**: `GET /requests/status.json?command=pl_stop`
- **Clear Playlist**: `GET /requests/status.json?command=pl_empty`

### Authentication
All requests require HTTP Basic Authentication:
- Username: (empty)
- Password: your VLC password

## Branch Configuration

### Multiple Branches Setup
Each branch needs:
1. Unique `BRANCH_ID`
2. Local VLC installation
3. Branch Speaker Client running
4. Network connection to Central Server

### Example Branch Configurations

#### Branch A
```env
BRANCH_ID=branch-colombo-01
VLC_HOST=localhost
VLC_PORT=8081
CENTRAL_SERVER_WS=ws://central-server:8080
```

#### Branch B
```env
BRANCH_ID=branch-kandy-01
VLC_HOST=localhost
VLC_PORT=8081
CENTRAL_SERVER_WS=ws://central-server:8080
```

## Troubleshooting

### Common Issues

1. **VLC Not Responding**
   - Ensure VLC is running with HTTP interface enabled
   - Check port availability (8081)
   - Verify password configuration

2. **Central Server Connection Failed**
   - Check if central server is running on port 3002
   - Verify WebSocket port 8080 is available
   - Check firewall settings

3. **No Audio Playback**
   - Verify VLC volume settings
   - Check audio output device in VLC
   - Test with direct VLC commands

4. **Branch Not Connecting**
   - Check branch client configuration
   - Verify network connectivity to central server
   - Check WebSocket connection logs

### Debug Commands

```bash
# Check VLC status
curl -u :vlcpassword "http://localhost:8081/requests/status.json"

# Check central server health
curl http://localhost:3002/api/health

# Check branch connections
curl http://localhost:3002/api/branches

# Test direct VLC playback
curl -u :vlcpassword "http://localhost:8081/requests/status.json?command=in_play&input=http://example.com/test.mp3"
```

## Production Deployment

### Central Server Deployment
1. Deploy central server on a cloud instance
2. Configure proper domain and SSL
3. Update environment variables with production URLs
4. Set up monitoring and logging

### Branch Deployment
1. Install VLC on each branch computer
2. Configure branch client with production central server URL
3. Set unique branch IDs
4. Set up automatic startup scripts

### Security Considerations
1. Use HTTPS/WSS for production
2. Implement authentication for central server
3. Configure VLC with strong passwords
4. Set up proper firewall rules
5. Monitor access logs

## Advanced Features

### Custom TTS Integration
Replace the fallback TTS service with:
- Google Cloud Text-to-Speech
- AWS Polly
- Azure Cognitive Services
- Local TTS engines

### Audio File Management
- Pre-recorded announcements
- Cached TTS audio files
- Audio compression optimization
- Content delivery network integration

### Monitoring and Analytics
- Announcement delivery confirmation
- Performance metrics
- Usage statistics
- Error tracking and alerting