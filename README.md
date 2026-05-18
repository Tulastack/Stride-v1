# User Registration Microservice

Three-tier architecture:

| Tier | Folder | Tech |
|------|--------|------|
| Frontend | `frontend/` | HTML + vanilla JS |
| API | `api/` | Node.js + Express |
| Database | `db/` | AWS Aurora DSQL (PostgreSQL) |

## Setup

### 1. Database
Connect to your Aurora DSQL cluster and run:
```bash
psql "host=<endpoint> dbname=postgres user=admin sslmode=require" -f db/schema.sql
```

### 2. API
```bash
cd api
cp .env.example .env        # fill in your DB credentials
npm install
npm start                   # runs on http://localhost:3000
```

### 3. Frontend
Open `frontend/index.html` in a browser, or serve it with any static file server:
```bash
npx serve frontend
```

## API

`POST /api/users`

```json
{ "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com" }
```

Returns `201` with the created user, `400` for validation errors, `409` for duplicate email.
