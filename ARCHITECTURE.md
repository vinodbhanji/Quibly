# Quibly — Complete Architecture & System Design Guide

> **A Discord-clone chat application** built with Next.js, Node.js/Express, PostgreSQL (Prisma), Redis, Apache Kafka, Socket.IO, and LiveKit.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack — Why Each Tool](#3-technology-stack--why-each-tool)
4. [Backend Deep Dive](#4-backend-deep-dive)
5. [Frontend Deep Dive](#5-frontend-deep-dive)
6. [Message Flow — End to End](#6-message-flow--end-to-end)
7. [Real-Time System Design](#7-real-time-system-design)
8. [Database Schema Design](#8-database-schema-design)
9. [Redis — How It Is Used](#9-redis--how-it-is-used)
10. [Kafka — How It Is Used](#10-kafka--how-it-is-used)
11. [Authentication & Security](#11-authentication--security)
12. [Voice & Video (LiveKit)](#12-voice--video-livekit)
13. [Scalability Design](#13-scalability-design)
14. [Deployment (Docker + K8s)](#14-deployment-docker--k8s)
15. [Interview Questions & Answers](#15-interview-questions--answers)
16. [Bugs Encountered During Development](#16-bugs-encountered-during-development)

---

## 1. Project Overview

**Quibly** is a full-stack real-time communication platform inspired by Discord. It supports:

- Text messaging in servers (guilds) and direct messages (DMs)
- Real-time delivery using Socket.IO
- Voice/video channels powered by LiveKit (WebRTC)
- Server creation, roles, channels, invites
- User presence (online/offline/idle/do-not-disturb)
- Friend system, server discovery, and member management
- Notifications, mentions, reactions
- File attachments, link previews
- Audit logs, auto-moderation, member screening

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                         │
│                                                             │
│   Browser (Next.js App Router + React + Zustand + TanStack) │
│                        ↕ HTTPS / WSS                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    REST API          Socket.IO      Next.js API Routes
    (Express)        (Real-time)    (server-side, auth)
          │                │
┌─────────▼────────────────▼──────────────────────────┐
│                   BACKEND LAYER                      │
│                                                      │
│   Node.js / Express                                  │
│   ┌───────────┐  ┌──────────┐  ┌─────────────────┐  │
│   │ REST APIs │  │Socket.IO │  │ Background Jobs  │  │
│   │ /api/*    │  │ server   │  │ BatchWriter      │  │
│   └─────┬─────┘  └────┬─────┘  │ PresenceCleanup │  │
│         │             │        └─────────────────┘  │
└─────────┼─────────────┼──────────────────────────────┘
          │             │
    ┌─────▼─────┐  ┌────▼──────────────────┐
    │ PostgreSQL│  │         Redis          │
    │ (Prisma)  │  │ ┌──────┐ ┌──────────┐ │
    │ primary   │  │ │Cache │ │ Pub/Sub  │ │
    │ datastore │  │ │Queue │ │ Adapter  │ │
    └───────────┘  │ │Locks │ │Presence  │ │
                   │ └──────┘ └──────────┘ │
                   └──────────┬────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Apache Kafka     │
                    │  Topic: chat-msgs  │
                    │ Producer → Consumer│
                    └────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   LiveKit Server   │
                    │  (WebRTC / Voice)  │
                    └────────────────────┘
```

---

## 3. Technology Stack — Why Each Tool

### 3.1 Next.js (Frontend)

**Why?**
- **App Router** gives file-system-based routing with nested layouts — perfect for the Discord-like sidebar + channel panel + chat panel layout.
- **Server Components** allow fetching initial data server-side (faster page loads, no flash of loading).
- **API Routes** (`/app/api/`) allow lightweight server-side operations without an extra server (e.g., OAuth callbacks, presigned URL generation).
- **Turbopack** (dev) makes hot-reload extremely fast.

**How it's used here:**
- `/app/channels/[serverId]/[channelId]` — the main chat route
- `/app/channels/@me/[dmId]` — direct messages
- `providers/` — React Context wrappers for Auth, Socket.IO, React Query
- `lib/store/` — Zustand stores for UI state, notifications, auth

---

### 3.2 PostgreSQL (via Prisma ORM)

**Why PostgreSQL and not MongoDB?**
- The data model is **deeply relational**: Users → ServerMembers → Servers → Channels → Messages, with foreign keys, unique constraints, transactions, and joins everywhere.
- PostgreSQL enforces **data integrity** at the DB level (cascading deletes, unique constraints).
- Prisma supports PostgreSQL best — full migration support, type safety, raw SQL when needed.
- **ACID transactions** are critical: creating a DM room and adding both participants must be atomic.

**How it's used:**
- Single source of truth for all persistent data
- Prisma ORM generates TypeScript-safe queries
- `PrismaPg` adapter is used for native PostgreSQL driver (better performance than default)
- Batch writes: messages are first queued in Redis, then bulk-inserted to Postgres every 30 seconds via `db.message.createMany()` with `skipDuplicates: true`

---

### 3.3 Redis

**Why Redis?**
Redis is used for **four distinct purposes** in this app:

| Purpose | Redis Data Structure | Key Pattern |
|---|---|---|
| Message cache (last 100 per channel) | Sorted Set (by timestamp) | `channel:{id}:messages` |
| Pending DB write queue | List (FIFO) | `messages:pending_db_write` |
| User presence tracking | Set + Sorted Set + Hash | `online:users`, `online:heartbeats`, `user:{id}:connection` |
| Socket.IO multi-instance pub/sub | Pub/Sub adapter | Internal |
| Batch writer leader election | String (NX lock) | `batch-writer-leader` |

**Deeper explanation:**

1. **Message Cache**: When a message arrives, it's cached in Redis using `ZADD` (sorted by timestamp). When a user opens a channel, the frontend first tries to read from the Redis cache. This avoids hitting the database for recent messages.

2. **Pending DB Write Queue**: Messages are pushed to a Redis List (`LPUSH`). The batch writer service polls this every 30 seconds and bulk-inserts to PostgreSQL. This prevents a DB write on every single message, dramatically reducing DB load.

3. **Presence**: Online users are tracked in a Redis Set. A heartbeat sorted set tracks when they were last seen. A cleanup job every 30 seconds removes users whose heartbeat is older than 6 minutes.

4. **Socket.IO Adapter**: When running multiple backend instances, Socket.IO needs a way to route events between instances. The Redis pub/sub adapter does this — if User A is on Server 1 and User B is on Server 2, a message on Server 1 is published to Redis and received by Server 2's Socket.IO, which then delivers it to User B.

5. **Leader Election**: Only one backend instance should run the batch DB writer at a time. Redis `SET key value NX EX 60` (atomic set-if-not-exists) implements a distributed lock. The instance that wins the lock becomes the "leader" and processes the batch queue.

---

### 3.4 Apache Kafka

**Why Kafka?**

Kafka decouples **message ingestion** from **message delivery and storage**:

```
User sends message
      ↓
Socket.IO handler (fast path)
      ↓  publishes to Kafka (non-blocking)
      ↓  immediately emits receive_message to channel room (instant)
      
Meanwhile, async in Kafka consumer:
      ↓  processMessage()
      ↓  cache in Redis
      ↓  push to Redis batch queue
      ↓  broadcast via Redis adapter to ALL servers
```

**Why this matters:**
- The socket handler returns **immediately** after publishing to Kafka — no waiting for DB.
- If the DB goes down temporarily, messages are safely in Kafka (durable log) and can be replayed.
- Kafka consumer group (`chat-fanout-service`) ensures exactly-once processing even across restarts.
- Supports high throughput: Kafka can handle millions of messages/second.

**Topic structure:**
- Topic: `chat-messages`
- Key: `channelId` (ensures messages in the same channel are ordered within a partition)
- Value: JSON serialized message object
- Headers: `event-type: message.created`, `timestamp`

**Fallback**: If Kafka is not connected, the socket falls back to a direct PostgreSQL write (sync, slower but reliable).

---

### 3.5 Socket.IO

**Why Socket.IO over raw WebSockets?**
- **Automatic reconnection** with exponential backoff
- **Room-based broadcasting** — `io.to(channelId).emit(...)` sends to all users in a channel
- **Redis adapter** for multi-instance scaling
- **Namespace support** for logical separation
- **Fallback to HTTP long-polling** if WebSocket is blocked

**Room structure:**
```
socket.join(channelId)     → receives messages for that text channel
socket.join(dmRoomId)      → receives DM messages
socket.join("user:userId") → receives personal events (friend requests, DMs etc.)
```

**Events:**
- `send_message` → client to server (user sends a message)
- `receive_message` → server to client (broadcast to room)
- `user_status_change` → presence updates
- `join_channel`, `join_dm` → client joins a room
- `dm_room_created`, `channel_created` → room lifecycle events

---

### 3.6 LiveKit (Voice & Video)

**Why LiveKit?**
- Open-source, self-hostable WebRTC SFU (Selective Forwarding Unit)
- Handles audio/video routing between multiple participants in a voice channel
- JWT-based access tokens generated on the backend
- Frontend uses `@livekit/components-react` for prebuilt UI

**Flow:**
1. User clicks "Join Voice Channel"
2. Frontend calls `POST /api/voice/token` with `channelId`
3. Backend generates a LiveKit JWT with room permissions
4. Frontend connects to LiveKit server with the token
5. LiveKit handles all WebRTC negotiation, track forwarding, etc.

---

## 4. Backend Deep Dive

### Directory Structure

```
backend/src/
├── index.js                  ← Express app, Socket.IO init, graceful shutdown
├── config/
│   ├── db.js                 ← Prisma client singleton (PrismaPg adapter)
│   ├── redis.js              ← Redis client wrapper (pub, sub, main clients)
│   ├── kafka.js              ← KafkaJS producer with SSL/SASL support
│   └── livekit.js            ← LiveKit token generation
├── controllers/              ← Business logic (21 controllers)
│   ├── authController.js     ← Register, login, OAuth, JWT, email verify
│   ├── messageController.js  ← CRUD for messages, attachments, reactions
│   ├── serverController.js   ← Server CRUD, member management, join/leave
│   ├── channelController.js  ← Channel CRUD, permissions
│   ├── dmController.js       ← Direct messages, DM room creation
│   ├── userController.js     ← Profile, presence, settings
│   ├── friendController.js   ← Friend requests, accept/deny/block
│   ├── voiceController.js    ← LiveKit token endpoint
│   └── ...                   ← Roles, invites, analytics, audit logs, etc.
├── routes/                   ← Express routers (map URLs to controllers)
├── middleware/               ← Auth middleware (JWT verify), rate limiting
├── services/
│   ├── messageProducer.js    ← Publishes to Kafka `chat-messages` topic
│   ├── messageFanout.js      ← Kafka consumer: cache → queue → broadcast
│   └── batchDBWriter.js      ← Leader-elected batch insert to PostgreSQL
├── socket/
│   ├── index.js              ← Socket.IO server init, auth middleware, adapter
│   └── message.socket.js     ← join_channel, send_message, leave_channel
└── utils/                    ← Helpers (email, cloudinary, validation, etc.)
```

### Key Design Decisions

**1. Singleton pattern for DB client**
```js
// Prevents multiple Prisma instances during hot reload in dev
const db = globalForPrisma.prisma ?? new PrismaClient({ adapter })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

**2. Graceful shutdown**
On `SIGTERM`/`SIGINT`, the server:
- Stops accepting new HTTP connections
- Flushes the batch writer queue to DB
- Disconnects Kafka producer
- Disconnects Redis clients
- Disconnects Prisma

**3. Health check endpoint** (`GET /health`)
Returns JSON with status of all services: `redis`, `kafka`, `database`, `socketio`, `batchWriterLeader`.

---

## 5. Frontend Deep Dive

### Directory Structure

```
frontend/
├── app/
│   ├── layout.tsx             ← Root layout: providers, NotificationManager
│   ├── page.tsx               ← Landing page
│   ├── channels/
│   │   └── [serverId]/[channelId]/  ← Main chat view
│   ├── login/, signup/        ← Auth pages
│   └── api/                   ← Next.js API routes (server-side)
├── components/
│   ├── channels/
│   │   └── EnhancedChannelsShell.tsx  ← Sidebar + layout shell
│   ├── chat/                  ← Message list, input, file upload
│   ├── discovery/             ← Server discovery modal
│   ├── modals/                ← All modal dialogs
│   ├── NotificationManager.tsx ← Socket listener for notifications
│   └── ...
├── providers/
│   ├── SocketProvider.tsx     ← Socket.IO connection + context
│   ├── AuthProvider.tsx       ← Auth state hydration
│   └── QueryProvider.tsx      ← TanStack Query client
├── hooks/
│   ├── queries.ts             ← All TanStack Query hooks (useMessages, useServers, etc.)
│   └── usePresence.ts         ← Real-time presence hook
├── lib/
│   ├── socket.ts              ← Socket.IO client factory
│   ├── socketQuerySync.ts     ← Syncs socket events → React Query cache
│   ├── api.ts                 ← Fetch wrapper with error handling
│   └── store/
│       ├── authStore.ts       ← Zustand: user auth state
│       ├── uiStore.ts         ← Zustand: selected channel, sidebar state
│       └── notificationStore.ts ← Zustand: unread counts, notification settings
└── middleware.ts              ← Next.js middleware: redirect unauthenticated users
```

### State Management Strategy

Three types of state, three different tools:

| State Type | Tool | Why |
|---|---|---|
| Server state (messages, users, servers) | TanStack Query | Caching, invalidation, background refetch |
| Real-time UI state (selected channel, sidebar) | Zustand | Fast, no boilerplate, no re-render issues |
| Auth state | Zustand (persisted) | Persists across refreshes via localStorage |

### Socket → React Query Sync

`socketQuerySync.ts` listens to socket events and **invalidates or updates** the TanStack Query cache:

```
receive_message → append to messages query cache (optimistic)
user_status_change → update user list cache
channel_created → invalidate channels query
dm_room_created → invalidate DM list, join new socket room
```

This way, the UI automatically updates without manual polling.

---

## 6. Message Flow — End to End

### Sending a Text Message (Happy Path with Kafka)

```
1. User types "Hello" and presses Enter
   └─ React: handleSubmit() → socket.emit("send_message", { channelId, content })

2. Backend: socket.on("send_message")
   ├─ Validate: user is a member of the channel's server
   ├─ Fetch sender info from DB
   ├─ Generate messageId (timestamp + random)
   ├─ publishMessage(messageData) → Kafka producer.send()
   ├─ socket.emit("message_sent", { id, tempId, status: "queued" })  ← ack to sender
   └─ io.to(channelId).emit("receive_message", broadcastData)        ← immediate local broadcast

3. Kafka: message lands in "chat-messages" topic
   └─ messageFanout consumer: eachMessage()
      ├─ redis.cacheMessage(channelId, message)   ← Sorted set, 24h TTL
      ├─ redis.addToBatchQueue(message)           ← List for batch write
      └─ io.to(channelId).emit("receive_message") ← broadcast via Redis adapter

4. All other clients in the channel room:
   └─ socket.on("receive_message") → append to message list (via socketQuerySync)

5. BatchDBWriter (runs every 30 seconds, leader-elected):
   ├─ redis.getBatchQueue(500)
   ├─ db.message.createMany({ data, skipDuplicates: true })
   └─ redis.clearBatchQueue(count)
```

### Fallback Path (Kafka unavailable)

```
socket.on("send_message")
  └─ Kafka not connected → db.message.create() (synchronous)
     └─ io.to(channelId).emit("receive_message")
```

---

## 7. Real-Time System Design

### Problem: Multiple Backend Instances

If you run 2 backend servers:
- User A connects to Server 1
- User B connects to Server 2
- User A sends a message → Server 1 emits to `io.to(channelId)`
- Server 2 never gets that event → User B misses the message

### Solution: Redis Pub/Sub Adapter

```js
const { createAdapter } = require('@socket.io/redis-adapter')
io.adapter(createAdapter(pubClient, subClient))
```

Now when Server 1 does `io.to(channelId).emit(...)`:
1. Redis adapter publishes the event to a Redis channel
2. Server 2's adapter is subscribed to that channel
3. Server 2 receives and emits to its local sockets in the room

### Problem: Socket Room Subscriptions

A socket must be explicitly joined to a room to receive events for it. Previously, users only joined the room they were currently viewing.

**Fix**: On socket `connect`, `joinAllRooms()` queries all server channels and DM rooms the user belongs to and calls `socket.join()` for each.

### Presence System

```
User connects:
  └─ redis.trackUserOnline(userId, socketId)
       ├─ SADD online:users {userId}
       ├─ ZADD online:heartbeats {score=Date.now()} {userId}
       └─ HSET user:{userId}:connection { serverId, socketId, connectedAt }
          EXPIRE user:{userId}:connection 300  (5 min TTL)

Every few minutes (heartbeat):
  └─ redis.refreshConnection(userId)   ← extends TTL

User disconnects:
  └─ redis.trackUserOffline(userId)

Cleanup job (every 30 sec):
  └─ ZRANGEBYSCORE online:heartbeats -inf (now - 6min)
     └─ For each stale userId:
        ├─ db.user.update({ status: 'offline', lastSeen: now })
        ├─ redis.removeFromOnline(userId)
        └─ io.emit("user_status_change", { userId, status: 'offline' })
```

---

## 8. Database Schema Design

### Core Entities and Relationships

```
User
├── ServerMember (many-to-many with Server)
├── DMParticipant (many-to-many with DMRoom)
├── Message (one-to-many)
├── Friendship (self-referential, bidirectional)
└── UserActivity, UserInterest

Server
├── Channel (one-to-many)
├── ServerMember (one-to-many)
├── Role (one-to-many)
├── Invite (one-to-many)
└── AuditLog

Channel
├── Message (one-to-many)
└── belongs to Server

Message
├── Reaction (one-to-many)
├── belongs to Channel OR DMRoom
├── parentId (self-reference for threads)
└── attachments[] JSON, mentions[] JSON

DMRoom
├── DMParticipant (one-to-many)
└── Message (one-to-many)
```

### Key Constraints

- `@@unique([userId, serverId])` on ServerMember — can't join server twice
- `@@unique([senderId, receiverId])` on Friendship — unique per pair
- `@@unique([messageId, userId, emoji])` on Reaction — one reaction per emoji per user
- Cascading deletes: deleting a Server cascades to Channels → Messages

---

## 9. Redis — How It Is Used

### Three Redis Client Instances

```js
client    → general GET/SET/ZADD/etc operations
pubClient → Socket.IO adapter publishing
subClient → Socket.IO adapter subscribing
```

Pub/Sub clients MUST be separate from the main client — Redis pub/sub mode locks a connection.

### Key Operations Reference

```
// Sorted set for message cache
ZADD channel:{channelId}:messages {timestamp} {messageJSON}
ZREMRANGEBYRANK channel:{channelId}:messages 0 -101  (keep last 100)
EXPIRE channel:{channelId}:messages 86400             (24h TTL)
ZRANGE channel:{channelId}:messages 0 49 REV          (get 50 newest)

// List for batch write queue
LPUSH messages:pending_db_write {messageJSON}
LRANGE messages:pending_db_write 0 499               (get up to 500)
LTRIM messages:pending_db_write 500 -1               (clear processed)

// Leader election (distributed lock)
SET batch-writer-leader {SERVER_ID} NX EX 60         (atomic lock)
GET batch-writer-leader                              (who is leader)
DEL batch-writer-leader                              (release lock)

// Presence
SADD online:users {userId}
ZADD online:heartbeats {timestamp} {userId}
HSET user:{userId}:connection {serverId} {socketId} {connectedAt}
EXPIRE user:{userId}:connection 300
```

---

## 10. Kafka — How It Is Used

### Producer Configuration

```js
producer = kafka.producer({
  allowAutoTopicCreation: false,  // disabled for cloud (Aiven)
  idempotent: true,               // exactly-once delivery guarantee
  maxInFlightRequests: 5,         // parallel message sending
})
```

**Idempotent producer**: Even if a message is sent twice (network retry), Kafka guarantees it's stored only once.

### Consumer Configuration

```js
consumer = kafka.consumer({
  groupId: 'chat-fanout-service',
  sessionTimeout: 30000,   // time before considered dead
  heartbeatInterval: 3000, // how often to ping Kafka
  maxWaitTimeInMs: 100,    // low latency polling
  autoCommit: true,        // auto-commit offsets every 1 second
})
```

### Message Key Strategy

```js
key: messageData.channelId
```

Same `channelId` → same Kafka partition → messages within a channel are **guaranteed to be ordered**.

### SSL/SASL for Aiven (Cloud Kafka)

Aiven requires mTLS (mutual TLS). Certificates can be:
1. Base64-encoded environment variables (preferred for CI/CD)
2. Files in `src/config/` (for local dev)

---

## 11. Authentication & Security

### JWT-based Auth

1. User logs in → backend generates `accessToken` (short TTL, e.g., 15m) + `refreshToken` (long TTL, stored in httpOnly cookie)
2. Every API request sends `Authorization: Bearer {accessToken}`
3. Backend middleware verifies JWT signature
4. Refresh endpoint generates new accessToken from refreshToken

### Socket.IO Authentication

Socket connects with `auth: { token }`. The socket middleware:
```js
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  const user = verifyJWT(token)
  socket.user = user  // attach user to socket
  next()
})
```

### Other Security Measures

- **Email verification** — users must verify email before full access
- **Password reset** — time-limited token sent via email
- **Google OAuth** — via `passport-google-oauth20`
- **CORS** — restricted to `FRONTEND_URL` env var in production
- **httpOnly cookies** — refresh tokens not accessible via JS
- **Rate limiting** — on auth endpoints
- **Ban system** — banned server members cannot rejoin

---

## 12. Voice & Video (LiveKit)

### Architecture

```
Frontend                Backend              LiveKit Server
   │                       │                      │
   │  POST /voice/token    │                      │
   │──────────────────────►│                      │
   │                       │  generateToken()     │
   │                       │ (signs JWT with      │
   │                       │  room + permissions) │
   │◄──────────────────────│                      │
   │   { token, wsUrl }    │                      │
   │                       │                      │
   │  connect(wsUrl, token)│                      │
   │──────────────────────────────────────────────►
   │         WebRTC Negotiation (ICE/DTLS/SRTP)   │
   │◄─────────────────────────────────────────────│
   │          Audio/Video streaming               │
```

### Token Permissions

```js
at.addGrant({
  roomJoin: true,
  room: channelId,     // maps voice channel ID to LiveKit room
  canPublish: true,    // can send audio/video
  canSubscribe: true,  // can receive from others
  canPublishData: true // can send data messages (screen share metadata etc.)
})
```

---

## 13. Scalability Design

### What Was Designed for Scale

| Component | Scaling Approach |
|---|---|
| Backend | Stateless Node.js — can run N instances behind a load balancer |
| Socket.IO | Redis adapter synchronizes events across all instances |
| Messages | Kafka decouples ingestion from storage — survives DB slowdowns |
| DB writes | Batch writes (500 msgs every 30s) instead of 1 write per message |
| Message reads | Redis cache serves recent messages — DB is cold path only |
| Presence | O(log N) sorted set cleanup, not a full table scan |
| Leader election | Redis NX lock — only 1 instance runs batch writer |
| Connections | LiveKit SFU handles WebRTC scaling (not P2P mesh) |

### Bottlenecks in Current State (Local Dev)

- Single PostgreSQL instance — no read replicas
- Single Redis instance — no Redis Cluster
- Kafka is optional (falls back to sync DB write)
- No CDN for file attachments

---

## 14. Deployment (Docker + K8s)

### Docker

Both `frontend/` and `backend/` have `Dockerfile`s. The root `.dockerignore` excludes `node_modules`.

### Kubernetes

The `k8s/` directory has a `namespace.yml` — K8s was planned for production deployment (likely with separate deployments for frontend, backend, Redis, and Kafka).

### CI/CD

`Jenkinsfile` at root — Jenkins pipeline for build and deploy.

### Environment Variables

```
# Backend
DATABASE_URL        → PostgreSQL connection string
REDIS_HOST          → Redis host
REDIS_PORT          → Redis port
REDIS_PASSWORD      → Redis auth
KAFKA_BROKERS       → Kafka broker addresses
KAFKA_USERNAME      → SASL username (Aiven)
KAFKA_PASSWORD      → SASL password (Aiven)
KAFKA_CA_CERT_BASE64 → mTLS CA cert (Base64)
LIVEKIT_API_KEY     → LiveKit API key
LIVEKIT_API_SECRET  → LiveKit API secret
LIVEKIT_WS_URL      → LiveKit WebSocket URL
JWT_SECRET          → JWT signing secret
FRONTEND_URL        → Allowed CORS origins

# Frontend
NEXT_PUBLIC_API_URL      → Backend REST API URL
NEXT_PUBLIC_SOCKET_URL   → Backend WebSocket URL
NEXT_PUBLIC_LIVEKIT_URL  → LiveKit server URL
```

---

## 15. Interview Questions & Answers

### System Design

**Q: How do you scale this chat app to 1 million concurrent users?**

A: Several layers:
1. **Horizontal scaling** of Node.js backend behind an L4/L7 load balancer
2. **Redis adapter** for Socket.IO means all backend instances share a message bus
3. **Kafka** absorbs message spikes — producers never block waiting for DB
4. **Redis cache** serves message history — DB is only hit for old/missing messages
5. **Read replicas** of PostgreSQL for heavy read traffic
6. **CDN** for static assets and file attachments
7. **LiveKit SFU** for voice — scales separately from text

---

**Q: Why did you use Kafka instead of just emitting through Socket.IO directly?**

A: Three reasons:
1. **Durability**: Kafka persists messages. If the DB goes down or is slow, messages aren't lost — they're replayed from the Kafka log.
2. **Decoupling**: The socket handler can return immediately without waiting for a DB write. This reduces latency for the sender.
3. **Fan-out**: The Kafka consumer handles caching, DB queuing, and broadcasting independently. Each concern is separated.

---

**Q: How do you prevent duplicate messages?**

A:
- Kafka producer is configured as **idempotent** (`idempotent: true`)
- Batch writer uses `db.message.createMany({ skipDuplicates: true })`
- Messages have a deterministic ID (timestamp + random string) — if the same message is inserted twice, the second one is a no-op

---

**Q: How does the leader election work?**

A: Redis distributed lock using `SET key value NX EX 60`:
- `NX` = "set only if not exists" — atomic, no race condition
- `EX 60` = auto-expire after 60 seconds (prevents lock stuck forever if leader crashes)
- The lock value is the `SERVER_ID` — only the owner can release it
- All instances run `processBatch()` every 30 seconds, but only the one that wins the lock does actual work

---

**Q: How do you handle a user connecting to multiple devices/tabs?**

A: Each socket gets its own room subscription. The `user:{userId}` room allows broadcasting personal events to all their sockets simultaneously. Messages are delivered to all sockets in the channel room.

---

**Q: What happens if Redis goes down?**

A:
- Socket.IO adapter falls back to single-instance mode (no cross-server delivery)
- Message cache is unavailable — falls back to PostgreSQL reads
- Batch queue is unavailable — falls back to synchronous DB writes
- Presence tracking stops — users appear offline after TTL expires
- Batch writer stops gracefully (checks `redis.isConnected()` before processing)
- The app **remains functional** — just loses performance optimizations

---

**Q: How does real-time notification work when the user is not actively viewing a channel?**

A:
1. All socket rooms are joined at connection time (`joinAllRooms()`)
2. `NotificationManager` on the frontend listens to all `receive_message` events
3. If the message is for a channel the user is NOT currently viewing, it increments an unread count in the Zustand store
4. The unread count is rendered as a badge on the channel sidebar
5. A toast notification is shown with a click-to-navigate action
6. When the user navigates to the channel, `clearNotifications(channelId)` is called

---

### React / Next.js

**Q: Why do you use TanStack Query alongside Zustand?**

A: They solve different problems:
- **TanStack Query**: Server state management — caching remote data, background refresh, deduplication of requests, stale-while-revalidate pattern
- **Zustand**: Client-only UI state — selected channel, sidebar open/closed, unread counts that don't need to be fetched from server

---

**Q: How do you keep the React Query cache in sync with Socket.IO real-time events?**

A: `socketQuerySync.ts` acts as a bridge. It listens to socket events and calls `queryClient.setQueryData()` or `queryClient.invalidateQueries()`:
```ts
socket.on("receive_message", (msg) => {
  queryClient.setQueryData(["messages", msg.channelId], (old) => 
    [...(old ?? []), msg]
  )
})
```

---

**Q: Why is the Prisma client wrapped in a singleton?**

A: Next.js/Node in development hot-reloads modules. Without the singleton, each reload creates a new Prisma connection pool, eventually exhausting database connections. The `global.prisma` pattern ensures only one instance exists per process lifetime.

---

**Q: What is the App Router and how does it differ from Pages Router?**

A: App Router (Next.js 13+) uses React Server Components by default. Layout nesting is automatic. Data fetching happens in components, not `getServerSideProps`. This enables streaming, Suspense boundaries, and partial rendering. Pages Router uses client components by default with `getServerSideProps`/`getStaticProps`.

---

### Backend / Node.js

**Q: Why three Redis clients (client, pubClient, subClient)?**

A: Redis's pub/sub mode is stateful — once a connection is in subscribe mode, it can only run pub/sub commands. You can't use the same connection for both `GET`/`SET` and pub/sub subscriptions. Socket.IO adapter requires dedicated pub/sub connections.

---

**Q: How does the Socket.IO auth middleware work?**

A: The client sends `{ auth: { token } }` in the handshake. The server middleware runs before any connection is established:
```js
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  try {
    const user = jwt.verify(token, JWT_SECRET)
    socket.user = user
    next() // allow connection
  } catch (e) {
    next(new Error("Unauthorized"))
  }
})
```

---

**Q: What is the CORS configuration doing?**

A: In production, only the `FRONTEND_URL` is allowed. In development, all origins pass. The `credentials: true` allows cookies (needed for httpOnly refresh token) to be sent cross-origin.

---

**Q: How does graceful shutdown work?**

A: On `SIGTERM`/`SIGINT`:
1. Stop accepting HTTP connections (`server.close()`)
2. Flush batch writer queue to DB
3. Disconnect Kafka, Redis, Prisma in parallel
4. Force exit after 10 seconds if still hanging

---

### Database

**Q: Why use `createMany` with `skipDuplicates` instead of upsert?**

A: Upsert requires per-row processing. `createMany` with `skipDuplicates: true` uses a single `INSERT ... ON CONFLICT DO NOTHING` SQL statement, which is significantly faster for bulk operations.

---

**Q: How would you add message search?**

A: Options in order of complexity:
1. PostgreSQL full-text search with `tsvector` columns (already built in, no extra infra)
2. Add Elasticsearch for fuzzy matching and advanced filters
3. Use Typesense (simpler than Elastic, self-hosted)

---

## 16. Bugs Encountered During Development

These are real issues that came up and were fixed during development.

---

### Bug 1 — Server Join Route Not Found (`POST /api/server/:id/join`)

**Symptom**: `Route not found: POST /api/server/cmpivs.../join`

**Root Cause**: The frontend was calling `/api/server/{id}/join` but the Express route was registered differently (wrong order or wrong path pattern).

**Fix**: Verified route ordering in `routes/` and ensured the parameterized `:serverId/join` route was registered before any conflicting wildcard routes.

**Lesson**: Express routes are matched top-to-bottom. Specific routes must come before parameterized ones.

---

### Bug 2 — Profile Settings Not Persisting (Activity, Connections, Privacy)

**Symptom**: Settings tabs like "Activity & Status", "Connections", "Privacy & Safety" showed no data and didn't save.

**Root Cause**: The frontend was submitting to endpoints that weren't returning the updated data, and React Query cache wasn't being invalidated after a successful update.

**Fix**: Added `queryClient.invalidateQueries(["profile"])` after successful PATCH requests. Also ensured the controllers returned the updated user object.

---

### Bug 3 — Notifications Silenced When User Was Idle

**Symptom**: After 30 seconds of inactivity, no toasts or sounds appeared even when messages were received.

**Root Cause**: `useIdle(30000)` was being used as a gate — all notification logic was skipped if `isIdle === true`.

**Fix**: Removed `useIdle` entirely. The idle check was blocking legitimate notifications. Only the **sound** and **toast** should arguably be gated, but even that is incorrect — users expect to see notifications when they return to the tab.

---

### Bug 4 — Sound Not Playing After Toggle Off/On

**Symptom**: After disabling and re-enabling notification sounds, the audio never played.

**Root Cause**: The audio element was loaded from an external CDN URL (`https://assets.mixkit.co/...`). Browser autoplay policy blocked `.play()` after the first user-gesture restriction expired. Also, CORS issues with the external URL.

**Fix**: Replaced the external audio file with a **Web Audio API synthesized chime** — two tones played using `AudioContext + OscillatorNode`. No network request, no CORS, no browser restriction (AudioContext is allowed in response to user interaction like typing).

---

### Bug 5 — Unread Badge Only Shows for One User, Not the Other

**Symptom**: User A sends a message to User B. User A sees the sent message. User B sees no badge and no notification.

**Root Cause**: Sockets on connect were only joining the currently active channel room. User B's socket was not in the other user's channel/DM room, so `io.to(roomId).emit()` didn't reach them.

**Fix**: On socket connect, `joinAllRooms()` queries all servers the user belongs to, all channels in those servers, and all DM rooms, and calls `socket.join()` for each. This ensures every socket receives events for all accessible rooms.

---

### Bug 6 — Presence Error: "Status text is required"

**Symptom**: Console error `Presence error: "Status text is required"` from `usePresence.ts`.

**Root Cause**: The backend presence endpoint expected a `statusText` field but the frontend was sending it as an empty string or `undefined`.

**Fix**: Added a default/fallback value so the field is never empty when sent to the backend. Validated on both frontend and backend.

---

### Bug 7 — `DialogContent` Accessibility Warning

**Symptom**: Console warning: `DialogContent requires a DialogTitle for screen reader users`.

**Root Cause**: Several dialogs were using Radix UI `DialogContent` without a `DialogTitle` (or `VisuallyHidden` wrapper).

**Fix**: Added `<DialogTitle className="sr-only">` or wrapped an existing title with `VisuallyHidden` in all dialogs missing it.

---

### Bug 8 — Duplicate Messages on Reconnect

**Symptom**: When a user reconnected after a brief disconnect, some messages appeared twice in the chat.

**Root Cause**: The Kafka consumer re-broadcast the message via `io.to(channelId).emit()` AND the socket handler also emitted to the channel immediately. On reconnect with the Redis adapter, both paths fired.

**Fix**: Idempotent message IDs (`skipDuplicates: true` in createMany) prevent DB duplicates. For UI duplicates, TanStack Query's `setQueryData` de-duplicates by message ID before rendering.

---

### Bug 9 — Multi-Instance Leader Election Race Condition

**Symptom**: In logs: `Lost leadership - another server is now batch writer leader` appearing frequently, causing the same batch to be processed twice.

**Root Cause**: Two backend instances were both reading the batch queue before either had acquired the lock.

**Fix**: The `acquireLock()` call using `SET NX EX` is atomic — only one instance can win. The issue was the lock TTL (60s) was shorter than the batch interval (30s), causing the lock to expire before the next cycle. Fixed by ensuring the lock is re-acquired each cycle before reading the queue.

---

### Bug 10 — Socket Room Not Joined for New DM Conversations

**Symptom**: When User A starts a new DM conversation with User B, User B doesn't receive the first message in real-time.

**Root Cause**: User B's socket had joined all existing DM rooms at connect time, but the new DM room didn't exist yet. The `joinAllRooms` on connect only covers existing rooms.

**Fix**: When a new DM room is created, the backend now emits `dm_room_created` to both users' `user:{userId}` personal rooms. The frontend listens for this event in `socketQuerySync.ts` and calls `socket.emit("join_dm", dmRoomId)` to join the new room.

---

*End of document.*
