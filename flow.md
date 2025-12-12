# Multi-Tenant Architecture Setup Guide

This guide documents the multi-tenant architecture implementation for Docmost, specifically configured for `wiki.weseegpt.com` as the base domain with tenant subdomains.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Domain Structure](#domain-structure)
- [How It Works](#how-it-works)
- [Code Changes Required](#code-changes-required)
- [Setup Instructions](#setup-instructions)
- [Testing Guide](#testing-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

Docmost already has multi-tenant infrastructure built-in. This guide explains how to configure it for a setup where:
- **Base Domain**: `wiki.weseegpt.com` (main landing/signup page)
- **Tenant Subdomains**: `test.wiki.weseegpt.com`, `acme.wiki.weseegpt.com`, etc. (individual workspaces)

### Key Features

- ✅ Workspace-based data isolation (all tables have `workspace_id`)
- ✅ Subdomain-based routing
- ✅ Automatic workspace resolution from hostname
- ✅ JWT token validation with workspace context
- ✅ Cross-subdomain cookie support

---

## Architecture

### Current Implementation

Docmost uses a **shared database with workspace isolation** approach:

- **Single Database**: All tenants share the same PostgreSQL database
- **Workspace Isolation**: Every table has a `workspace_id` column
- **Subdomain Routing**: Domain middleware extracts subdomain and resolves workspace
- **Query Filtering**: All queries automatically filter by `workspace_id`

### Database Schema

```sql
workspaces:
  - id (uuid)
  - name (varchar)
  - hostname (varchar)  -- Used for subdomain routing
  - custom_domain (varchar)  -- For future custom domain support
  - ...

users:
  - id (uuid)
  - email (varchar)
  - workspace_id (uuid)  -- Tenant isolation
  - ...

pages:
  - id (uuid)
  - title (varchar)
  - workspace_id (uuid)  -- Tenant isolation
  - ...
```

---

## Domain Structure

### Configuration

```
Base Domain:     wiki.weseegpt.com
Tenant Pattern:  {hostname}.wiki.weseegpt.com

Examples:
- test.wiki.weseegpt.com  → Workspace with hostname="test"
- acme.wiki.weseegpt.com  → Workspace with hostname="acme"
- demo.wiki.weseegpt.com  → Workspace with hostname="demo"
```

### How Domain Resolution Works

1. **Request arrives**: `test.wiki.weseegpt.com`
2. **Domain Middleware extracts**: `"test"` (first part before first dot)
3. **Database lookup**: `SELECT * FROM workspaces WHERE hostname = 'test'`
4. **Workspace found**: Sets `req.raw.workspaceId = workspace.id`
5. **All queries filtered**: `WHERE workspace_id = workspace.id`

### Protected Hostnames

The hostname `"wiki"` is in the `DISALLOWED_HOSTNAMES` list, which means:
- ✅ No workspace can have hostname "wiki"
- ✅ `wiki.weseegpt.com` will not resolve to a workspace
- ✅ It serves as the main landing/signup page

---

## How It Works

### Request Flow

#### Scenario 1: Base Domain (`wiki.weseegpt.com`)

```
Request: GET https://wiki.weseegpt.com
Host Header: "wiki.weseegpt.com"
↓
DomainMiddleware:
  - Extracts: "wiki" (from header.split('.')[0])
  - Queries: SELECT * FROM workspaces WHERE hostname = 'wiki'
  - Result: No workspace found (because "wiki" is in DISALLOWED_HOSTNAMES)
  - Sets: req.raw.workspaceId = null
↓
Main.ts Hook:
  - Checks excluded paths: /api/workspace/create, /api/auth/setup, etc.
  - Allows request to proceed (workspace creation, signup, etc.)
↓
Result: Landing page / Signup page / Workspace creation page
```

#### Scenario 2: Tenant Subdomain (`test.wiki.weseegpt.com`)

```
Request: GET https://test.wiki.weseegpt.com/api/pages
Host Header: "test.wiki.weseegpt.com"
↓
DomainMiddleware:
  - Extracts: "test" (from header.split('.')[0])
  - Queries: SELECT * FROM workspaces WHERE hostname = 'test'
  - Result: Workspace found with id = 'workspace-uuid-123'
  - Sets: req.raw.workspaceId = 'workspace-uuid-123'
↓
JWT Auth Guard:
  - Validates token includes workspaceId = 'workspace-uuid-123'
  - Sets: req.user = { user, workspace }
↓
Controller/Service:
  - All queries filter by: WHERE workspace_id = 'workspace-uuid-123'
↓
Result: Returns only data for "test" workspace
```

### Data Isolation

All database queries are automatically scoped by `workspace_id`:

```typescript
// User queries
userRepo.findById(userId, workspaceId)  // ✅ Scoped

// Page queries  
pageRepo.findById(pageId)  // ⚠️ Should include workspaceId check

// Space queries
spaceRepo.getSpacesInWorkspace(workspaceId)  // ✅ Scoped
```

---

## Code Changes Required

### 1. Fix Auth Cookie Domain

**File**: `apps/server/src/core/auth/auth.controller.ts`

#### Update `setAuthCookie` method:

```typescript
setAuthCookie(res: FastifyReply, token: string) {
  const cookieOptions: any = {
    httpOnly: true,
    path: '/',
    expires: this.environmentService.getCookieExpiresIn(),
    secure: this.environmentService.isHttps(),
  };

  // Add domain for cloud mode to enable cross-subdomain cookies
  if (this.environmentService.isCloud()) {
    const subdomainHost = this.environmentService.getSubdomainHost();
    if (subdomainHost) {
      cookieOptions.domain = '.' + subdomainHost;
    }
  }

  res.setCookie('authToken', token, cookieOptions);
}
```

#### Update `logout` method:

```typescript
@UseGuards(JwtAuthGuard)
@HttpCode(HttpStatus.OK)
@Post('logout')
async logout(@Res({ passthrough: true }) res: FastifyReply) {
  const cookieOptions: any = {
    path: '/',
  };

  if (this.environmentService.isCloud()) {
    const subdomainHost = this.environmentService.getSubdomainHost();
    if (subdomainHost) {
      cookieOptions.domain = '.' + subdomainHost;
    }
  }

  res.clearCookie('authToken', cookieOptions);
}
```

### 2. Fix Workspace Invitation Cookie

**File**: `apps/server/src/core/workspace/controllers/workspace.controller.ts`

Update the `acceptInvite` method (around line 272):

```typescript
res.setCookie('authToken', result.authToken, {
  httpOnly: true,
  path: '/',
  expires: this.environmentService.getCookieExpiresIn(),
  secure: this.environmentService.isHttps(),
  // Add domain for cloud mode
  ...(this.environmentService.isCloud() && {
    domain: '.' + this.environmentService.getSubdomainHost(),
  }),
});
```

### 3. Optional: Enhance Domain Middleware

**File**: `apps/server/src/common/middlewares/domain.middleware.ts`

Make base domain handling more explicit:

```typescript
async use(
  req: FastifyRequest['raw'],
  res: FastifyReply['raw'],
  next: () => void,
) {
  if (this.environmentService.isSelfHosted()) {
    const workspace = await this.workspaceRepo.findFirst();
    if (!workspace) {
      (req as any).workspaceId = null;
      return next();
    }
    (req as any).workspaceId = workspace.id;
    (req as any).workspace = workspace;
  } else if (this.environmentService.isCloud()) {
    const header = req.headers.host;
    const subdomainHost = this.environmentService.getSubdomainHost();
    
    // Check if this is the base domain (exact match)
    if (header === subdomainHost || header === `www.${subdomainHost}`) {
      // Base domain - allow for signup/workspace creation
      (req as any).workspaceId = null;
      (req as any).isBaseDomain = true;
      return next();
    }
    
    // Extract subdomain (first part before first dot)
    const subdomain = header.split('.')[0];
    
    // Lookup workspace by hostname
    const workspace = await this.workspaceRepo.findByHostname(subdomain);
    
    if (!workspace) {
      (req as any).workspaceId = null;
      return next();
    }
    
    (req as any).workspaceId = workspace.id;
    (req as any).workspace = workspace;
  }
  
  next();
}
```

---

## Setup Instructions

### Step 1: Apply Code Changes

Apply the code changes listed in the [Code Changes Required](#code-changes-required) section above.

### Step 2: Configure Environment Variables

Create or update `.env` file in the root directory:

```env
# Multi-Tenant Cloud Mode Configuration
CLOUD=true
SUBDOMAIN_HOST=wiki.weseegpt.com
APP_URL=http://wiki.weseegpt.com:3000

# Database Configuration
DATABASE_URL=postgresql://docmost:password@localhost:5432/docmost?schema=public
REDIS_URL=redis://localhost:6379

# Security (IMPORTANT: Change this to a secure random string)
APP_SECRET=your-super-secret-key-at-least-32-characters-long-for-local-testing-change-this-in-production

# Server Configuration
NODE_ENV=development
PORT=3000

# Optional: Email Configuration (for development)
MAIL_DRIVER=log

# Optional: Storage (local for development)
STORAGE_DRIVER=local
```

**Important**: 
- Replace `password` with your actual PostgreSQL password
- Generate a secure `APP_SECRET` (at least 32 characters)

### Step 3: Configure Hosts File

#### Windows

1. Open Notepad as Administrator
2. Open file: `C:\Windows\System32\drivers\etc\hosts`
3. Add these lines:
   ```
   127.0.0.1       wiki.weseegpt.com
   127.0.0.1       test.wiki.weseegpt.com
   127.0.0.1       acme.wiki.weseegpt.com
   127.0.0.1       demo.wiki.weseegpt.com
   ```
4. Save the file
5. Flush DNS cache: `ipconfig /flushdns` (run in admin terminal)

#### Linux/Mac

1. Open terminal and edit hosts file:
   ```bash
   sudo nano /etc/hosts
   # or
   sudo vim /etc/hosts
   ```
2. Add these lines:
   ```
   127.0.0.1       wiki.weseegpt.com
   127.0.0.1       test.wiki.weseegpt.com
   127.0.0.1       acme.wiki.weseegpt.com
   127.0.0.1       demo.wiki.weseegpt.com
   ```
3. Save and exit

### Step 4: Setup Database and Redis

#### Option A: Using Docker Compose

```bash
# Start only database and redis services
docker-compose up -d db redis
```

#### Option B: Manual Setup

- Ensure PostgreSQL is running on port 5432
- Ensure Redis is running on port 6379

#### Create Database (if needed)

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE docmost;

# Create user (if needed)
CREATE USER docmost WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE docmost TO docmost;
```

### Step 5: Run Migrations

```bash
# From project root
pnpm --filter ./apps/server run migration:latest
```

### Step 6: Install Dependencies

```bash
# From project root
pnpm install
```

### Step 7: Start Development Server

```bash
# From project root
pnpm run dev
```

This starts both frontend and backend. You should see:
```
frontend | VITE ready in XXX ms
backend  | Listening on http://127.0.0.1:3000
```

---

## Testing Guide

### Test 1: Base Domain

Open browser:
```
http://wiki.weseegpt.com:3000
```

**Expected**: Landing page or workspace setup page

### Test 2: API Health Check

```bash
curl http://wiki.weseegpt.com:3000/api/health
```

### Test 3: Check Hostname Availability

```bash
curl -X POST http://wiki.weseegpt.com:3000/api/workspace/check-hostname \
  -H "Content-Type: application/json" \
  -d '{"hostname": "test"}'
```

**Expected**: `{"available": true}` or `{"available": false}`

### Test 4: Create Workspace

Via API:
```bash
curl -X POST http://wiki.weseegpt.com:3000/api/workspace/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Workspace",
    "hostname": "test"
  }'
```

Or via UI at `http://wiki.weseegpt.com:3000`

### Test 5: Access Tenant Subdomain

After creating a workspace with hostname "test", visit:
```
http://test.wiki.weseegpt.com:3000
```

**Expected**: Workspace dashboard (if authenticated) or login page

### Test 6: Verify Workspace Isolation

1. Create a page in "test" workspace
2. Create a page in "acme" workspace
3. Verify pages don't appear in the wrong workspace

### Test 7: Cookie Persistence

1. Login at `test.wiki.weseegpt.com:3000`
2. Navigate to `wiki.weseegpt.com:3000`
3. Check browser cookies - `authToken` should be present with domain `.wiki.weseegpt.com`

### Verification Checklist

- [ ] Code changes applied (cookie domain fixes)
- [ ] `.env` file created with correct values
- [ ] Hosts file updated with domain entries
- [ ] PostgreSQL and Redis running
- [ ] Database migrations completed
- [ ] Dependencies installed (`pnpm install`)
- [ ] Server starts without errors (`pnpm run dev`)
- [ ] Base domain accessible (`wiki.weseegpt.com:3000`)
- [ ] Subdomain routing works (`test.wiki.weseegpt.com:3000`)
- [ ] Workspace isolation verified
- [ ] Cookies work across subdomains

---

## Troubleshooting

### Issue: "Workspace not found" on all subdomains

**Solution**:
- Verify `CLOUD=true` in `.env`
- Check `SUBDOMAIN_HOST` is set correctly
- Ensure workspace exists with matching hostname
- Check domain middleware is running

### Issue: Cookies not persisting across subdomains

**Solution**:
- Ensure cookie domain is set to `.wiki.weseegpt.com`
- Check browser allows cookies for localhost
- Verify `secure: false` for HTTP in development
- Check code changes were applied correctly

### Issue: Domain not resolving

**Solution**:
- Verify hosts file entries are correct
- Flush DNS cache:
  - Windows: `ipconfig /flushdns`
  - Mac: `sudo dscacheutil -flushcache`
  - Linux: `sudo systemd-resolve --flush-caches`
- Try accessing with port: `http://wiki.weseegpt.com:3000`
- Check hosts file permissions (may need admin/sudo)

### Issue: CORS errors

**Solution**:
- Check `APP_URL` matches your access URL
- Verify CORS is enabled in `main.ts`
- Check browser console for specific CORS error

### Issue: Port already in use

**Solution**:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill

# Or change PORT in .env
```

### Issue: Database connection error

**Solution**:
- Check PostgreSQL is running: `pg_isready`
- Verify `DATABASE_URL` in `.env` is correct
- Check database exists: `psql -U docmost -d docmost`
- Verify user permissions

### Issue: "Cannot find module" errors

**Solution**:
```bash
# Clean install
rm -rf node_modules
pnpm install
```

---

## Production Deployment

### DNS Configuration

For production, configure DNS:

```
# Wildcard DNS record
*.wiki.weseegpt.com  A  →  Your Server IP

# Or specific records
wiki.weseegpt.com     A  →  Your Server IP
*.wiki.weseegpt.com   A  →  Your Server IP
```

### SSL Certificate

- Use wildcard certificate: `*.wiki.weseegpt.com`
- Or use Let's Encrypt with DNS challenge for wildcard
- Configure reverse proxy (nginx) for SSL termination

### Environment Variables

Update `.env` for production:

```env
CLOUD=true
SUBDOMAIN_HOST=wiki.weseegpt.com
APP_URL=https://wiki.weseegpt.com

# Use secure values
APP_SECRET=<generate-secure-32-char-secret>
DATABASE_URL=<production-database-url>
REDIS_URL=<production-redis-url>

# Enable HTTPS
NODE_ENV=production
```

### Security Considerations

1. **Row Level Security (RLS)**: Consider enabling PostgreSQL RLS policies
2. **Query Interceptors**: Add global interceptor to enforce workspace filtering
3. **Audit Logging**: Log all workspace access for security
4. **Rate Limiting**: Implement per-workspace rate limiting
5. **Data Export**: Ensure GDPR compliance with per-tenant data export

---

## Architecture Decisions

### Why Shared Database?

- ✅ Simpler operations (single database to manage)
- ✅ Easier migrations (one migration for all tenants)
- ✅ Cost-effective (no per-tenant database overhead)
- ✅ Good performance for most use cases

### Why Subdomain Routing?

- ✅ Clean URLs (`test.wiki.weseegpt.com`)
- ✅ Easy to implement (hostname extraction)
- ✅ Works with existing infrastructure
- ✅ Supports custom domains in future

### Future Enhancements

1. **Custom Domain Support**: Full domain mapping (e.g., `docs.company.com`)
2. **Database-per-Tenant**: For enterprise customers requiring strict isolation
3. **Hybrid Approach**: Mix of shared and dedicated databases
4. **Tenant Analytics**: Usage tracking per workspace
5. **Advanced Security**: RLS policies, audit trails

---

## Quick Reference

### Environment Variables

```env
CLOUD=true                          # Enable multi-tenant mode
SUBDOMAIN_HOST=wiki.weseegpt.com    # Base domain for tenants
APP_URL=http://wiki.weseegpt.com:3000
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
APP_SECRET=<32-char-secret>
```

### Key Commands

```bash
# Start services
docker-compose up -d db redis

# Run migrations
pnpm --filter ./apps/server run migration:latest

# Start dev server
pnpm run dev

# Check health
curl http://wiki.weseegpt.com:3000/api/health
```

### Important Files

- `apps/server/src/common/middlewares/domain.middleware.ts` - Domain routing
- `apps/server/src/core/auth/auth.controller.ts` - Auth cookie handling
- `apps/server/src/core/workspace/controllers/workspace.controller.ts` - Workspace management
- `.env` - Environment configuration
- `/etc/hosts` (or `C:\Windows\System32\drivers\etc\hosts`) - Local DNS

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the code changes in [Code Changes Required](#code-changes-required)
3. Verify environment configuration
4. Check server logs for detailed error messages

---

## License

This setup guide is part of the Docmost project. Refer to the main project LICENSE file for details.

