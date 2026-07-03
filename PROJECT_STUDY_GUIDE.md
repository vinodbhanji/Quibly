# Quibly Project Study Guide

This guide is for someone joining Quibly with no prior context. Use it to understand the project quickly, prepare to work on it, and answer common questions in a review or handoff.

## 1. What Quibly Is

Quibly is a real-time communication platform similar to Discord. It includes:

- Server and channel management
- Direct messages and friend system
- Real-time chat with Socket.IO
- Voice and video calls with LiveKit
- Notifications, presence, reactions, file uploads, and moderation features

The repository is split into:

- `frontend/` for the Next.js app
- `backend/` for the Bun/Express API, sockets, Prisma, Redis, Kafka, and related services
- `k8s/` and Docker files for deployment

## 2. Best Workflow To Study The Project

Follow this order. It avoids getting lost in implementation details too early.

### Step 1: Read the product story first

Start with:

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

Goal:

- Understand the product type
- Learn the main features
- Identify the stack and runtime dependencies
- Get a mental model of the system before opening code

### Step 2: Map the top-level folders

Focus on these areas:

- `frontend/app/` for routes and pages
- `frontend/components/` for reusable UI pieces
- `frontend/lib/` for API, socket, auth, and utility logic
- `backend/src/controllers/` for API behavior
- `backend/src/routes/` for endpoint wiring
- `backend/src/services/` for background and infra-related logic
- `backend/src/socket/` for real-time behavior
- `backend/prisma/` for schema and seed data

Goal:

- Know where UI, API, and real-time logic live
- Know which folders are wiring versus business logic

### Step 3: Trace one user flow end to end

Pick one flow and follow it through the repo. Good first choices:

- Sign up and login
- Open a server channel
- Send a message
- Join a voice channel
- Accept a friend request

For each flow, identify:

- The page or route in the frontend
- The API call or socket event
- The backend controller or service that handles it
- The database tables it touches
- Any cache, queue, or broadcast step involved

Goal:

- Understand the real execution path instead of reading files in isolation

### Step 4: Understand the runtime architecture

Quibly uses several systems together:

- Next.js for the frontend
- Express for the backend API
- Prisma and PostgreSQL for persistent data
- Redis for cache, presence, queueing, and coordination
- Kafka for asynchronous message fanout
- Socket.IO for live updates
- LiveKit for voice and video

Goal:

- Know why each tool exists and what problem it solves

### Step 5: Learn the data model

Read the Prisma schema and note the main entities:

- Users
- Servers
- Channels
- Messages
- Direct messages
- Roles and permissions
- Friend requests
- Presence and notifications

Goal:

- Be able to explain how the application stores and relates data

### Step 6: Check how the app is started locally

Read the backend and frontend README files and inspect the package scripts.

Goal:

- Know what commands are needed to install, run, and test the project
- Know what external services must be available

### Step 7: Review deployment and infrastructure assumptions

Look at:

- `Dockerfile`
- `backend/docker-compose.yaml`
- `k8s/namespace.yml`

Goal:

- Understand whether the app is designed for local development, containers, or clustered deployment

## 3. What To Learn First

If time is limited, prioritize this order:

1. Product purpose and feature set
2. Frontend routing and UI structure
3. Backend controllers and routes
4. Prisma schema and database relations
5. Socket.IO event flow
6. Redis and Kafka usage
7. LiveKit voice/video integration
8. Deployment and environment variables

## 4. Questions You Should Be Able To Answer

After studying the project, you should be able to explain:

- What problem Quibly solves
- Why the system needs both REST and Socket.IO
- How messages travel from client to storage to other clients
- Why Redis and Kafka are both present
- How authentication works
- How presence is tracked
- How voice channels are handled
- Which parts of the app are stateful versus stateless
- How the frontend talks to the backend
- Which modules are likely to change together when adding a feature

## 5. Possible Questions You May Be Asked

These are realistic questions for a handoff, review, or interview-style discussion.

### Product And Domain

- What is Quibly and who is it for?
- What are the core features of the platform?
- Which features are real-time and which are standard request/response?
- What user flows matter most in the application?

### Frontend

- How is the frontend organized in Next.js?
- Where are routes, layouts, and shared UI components defined?
- How does the frontend manage global state?
- How does the app handle authentication and route protection?
- How does the frontend receive live updates?

### Backend

- How are routes organized in the backend?
- Which controllers handle messages, auth, friends, and channels?
- What is the difference between controllers and services here?
- How does the backend validate requests and enforce permissions?
- How are background or asynchronous jobs handled?

### Database And Data Flow

- What are the main database entities and their relationships?
- Why was Prisma chosen for this project?
- How are migrations and seeding handled?
- Which tables are most critical for chat and server behavior?

### Real-Time System

- Why does the app use Socket.IO instead of only REST APIs?
- How does a message reach all connected clients?
- What role does Redis play in real-time delivery?
- Why is Kafka used in the message pipeline?
- How is user presence kept up to date?

### Voice, Video, And Media

- How does voice channel joining work?
- How does LiveKit fit into the architecture?
- How are files uploaded and shared?
- How are link previews generated?

### Deployment And Operations

- How do you run the project locally?
- What services must be available before the app works?
- How is the system deployed with Docker or Kubernetes?
- What are the most likely operational bottlenecks?

## 6. Suggested Preparation Checklist

Before any task or meeting, make sure you can do these things:

- Run the frontend and backend locally
- Point to the main route files in the frontend
- Point to the main controllers and routes in the backend
- Explain the message flow end to end
- Explain why Redis and Kafka are both used
- Explain the auth flow at a high level
- Identify the Prisma schema entry points
- Name the key environment variables

## 7. Quick Study Plan For The First 1-2 Days

### Day 1

- Read `README.md` and `ARCHITECTURE.md`
- Skim the folder structure
- Open the login, channel, and message-related code paths
- Identify the main API routes and socket events

### Day 2

- Read the Prisma schema
- Follow one full user flow from UI to database
- Review Redis, Kafka, and LiveKit usage
- Look at Docker and environment setup

## 8. Practical Way To Take Notes

Create a short note for each of these topics:

- Routing and navigation
- Auth and permissions
- Message lifecycle
- Presence and notifications
- Friends and DMs
- Voice and media
- Deployment and infra

For each note, write:

- What it does
- Where the code lives
- Which services it depends on
- What breaks if it fails

## 9. Final Rule Of Thumb

Do not try to memorize the whole repository. Learn the product shape, then trace the main flows, then drill into the modules only when you need implementation detail.