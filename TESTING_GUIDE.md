# Multi-Tenant Testing Guide

This guide provides PowerShell commands to test the multi-tenant workspace creation functionality.

## Prerequisites

1. ✅ Server is running on `http://wiki.weseegpt.com:3000`
2. ✅ Environment variables are set:
   - `CLOUD=true`
   - `SUBDOMAIN_HOST=wiki.weseegpt.com`
3. ✅ Hosts file is configured with domain entries

## Testing Commands (PowerShell)

### Test 1: Health Check

```powershell
Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/health" | ConvertTo-Json
```

**Expected**: `{"status":"ok",...}`

---

### Test 2: Check Hostname Availability

```powershell
# Check if "test" hostname is available
$body = @{hostname="test"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/check-hostname" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body | ConvertTo-Json
```

**Expected**: `{"available": true}` (if not taken) or `{"available": false}` (if taken or disallowed)

**Test with disallowed hostname:**
```powershell
$body = @{hostname="wiki"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/check-hostname" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body | ConvertTo-Json
```

**Expected**: `{"available": false}` (because "wiki" is in DISALLOWED_HOSTNAMES)

---

### Test 3: Create New Workspace

**Important**: This must be called from the base domain (`wiki.weseegpt.com`), not from a subdomain.

```powershell
$body = @{
    name = "John Doe"
    email = "john@example.com"
    password = "SecurePass123!"
    workspaceName = "Test Workspace"
    hostname = "test"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body | ConvertTo-Json -Depth 5
```

**Expected Response:**
```json
{
  "workspace": {
    "id": "...",
    "name": "Test Workspace",
    "hostname": "test",
    ...
  },
  "exchangeToken": "..."
}
```

**Note**: The response includes an `authToken` cookie that's set with domain `.wiki.weseegpt.com` for cross-subdomain access.

---

### Test 4: Access Workspace via Subdomain

After creating a workspace with hostname "test", you can access it at:

```powershell
# Access the workspace subdomain
Invoke-RestMethod -Uri "http://test.wiki.weseegpt.com:3000/api/workspace/public" -Method POST -Headers @{"Content-Type"="application/json"} -Body "{}" | ConvertTo-Json
```

**Expected**: Workspace public information for "test" workspace

---

### Test 5: Create Multiple Workspaces

```powershell
# Workspace 1: "acme"
$body1 = @{
    name = "Alice Smith"
    email = "alice@acme.com"
    password = "SecurePass123!"
    workspaceName = "ACME Corp"
    hostname = "acme"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body1 | ConvertTo-Json

# Workspace 2: "demo"
$body2 = @{
    name = "Bob Johnson"
    email = "bob@demo.com"
    password = "SecurePass123!"
    workspaceName = "Demo Workspace"
    hostname = "demo"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body2 | ConvertTo-Json
```

---

### Test 6: Verify Workspace Isolation

1. Create a page in "test" workspace (requires authentication)
2. Create a page in "acme" workspace
3. Verify pages don't appear in the wrong workspace

---

### Test 7: Cookie Persistence Across Subdomains

1. Login at `test.wiki.weseegpt.com:3000`
2. Navigate to `wiki.weseegpt.com:3000`
3. Check browser cookies - `authToken` should be present with domain `.wiki.weseegpt.com`

**To test in PowerShell (checking cookies):**
```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$response = Invoke-WebRequest -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body -WebSession $session
$session.Cookies.GetCookies("http://wiki.weseegpt.com:3000")
```

---

## Error Scenarios

### Error 1: Creating workspace from subdomain (should fail)

```powershell
# This should fail - trying to create from subdomain
$body = @{
    name = "Test User"
    email = "test@example.com"
    password = "SecurePass123!"
    workspaceName = "Test"
    hostname = "newtest"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "http://test.wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
} catch {
    Write-Host "Expected error: $_"
}
```

**Expected**: `403 Forbidden - Workspace creation is only allowed from the base domain`

---

### Error 2: Duplicate email (should fail)

```powershell
# Try to create workspace with same email
$body = @{
    name = "Another User"
    email = "john@example.com"  # Same email as Test 3
    password = "SecurePass123!"
    workspaceName = "Another Workspace"
    hostname = "another"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
} catch {
    Write-Host "Expected error: $_"
}
```

**Expected**: `400 Bad Request - An account with this email already exists`

---

### Error 3: Duplicate hostname (should fail)

```powershell
# Try to create workspace with existing hostname
$body = @{
    name = "New User"
    email = "new@example.com"
    password = "SecurePass123!"
    workspaceName = "Duplicate Workspace"
    hostname = "test"  # Same hostname as Test 3
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "http://wiki.weseegpt.com:3000/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
} catch {
    Write-Host "Expected error: $_"
}
```

**Expected**: Hostname conflict or auto-generated unique hostname

---

## Complete Test Script

Save this as `test-multitenant.ps1`:

```powershell
# Multi-Tenant Workspace Creation Test Script

$baseUrl = "http://wiki.weseegpt.com:3000"

Write-Host "=== Test 1: Health Check ===" -ForegroundColor Green
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health"
    Write-Host "✓ Health check passed: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "✗ Health check failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Test 2: Check Hostname Availability ===" -ForegroundColor Green
$body = @{hostname="test"} | ConvertTo-Json
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/api/workspace/check-hostname" -Method POST -Headers @{"Content-Type"="application/json"} -Body $body
    Write-Host "✓ Hostname 'test' availability: $($result.data.available)" -ForegroundColor Green
} catch {
    Write-Host "✗ Hostname check failed: $_" -ForegroundColor Red
}

Write-Host "`n=== Test 3: Create Workspace ===" -ForegroundColor Green
$workspaceBody = @{
    name = "Test User"
    email = "testuser@example.com"
    password = "SecurePass123!"
    workspaceName = "Test Workspace"
    hostname = "test"
} | ConvertTo-Json

try {
    $workspace = Invoke-RestMethod -Uri "$baseUrl/api/workspace/create" -Method POST -Headers @{"Content-Type"="application/json"} -Body $workspaceBody
    Write-Host "✓ Workspace created successfully!" -ForegroundColor Green
    Write-Host "  Workspace ID: $($workspace.data.workspace.id)" -ForegroundColor Cyan
    Write-Host "  Workspace Name: $($workspace.data.workspace.name)" -ForegroundColor Cyan
    Write-Host "  Hostname: $($workspace.data.workspace.hostname)" -ForegroundColor Cyan
    Write-Host "  Access URL: http://$($workspace.data.workspace.hostname).wiki.weseegpt.com:3000" -ForegroundColor Yellow
} catch {
    Write-Host "✗ Workspace creation failed: $_" -ForegroundColor Red
    Write-Host "  Error details: $($_.Exception.Response)" -ForegroundColor Red
}

Write-Host "`n=== Test 4: Access Workspace via Subdomain ===" -ForegroundColor Green
try {
    $publicInfo = Invoke-RestMethod -Uri "http://test.wiki.weseegpt.com:3000/api/workspace/public" -Method POST -Headers @{"Content-Type"="application/json"} -Body "{}"
    Write-Host "✓ Successfully accessed workspace via subdomain" -ForegroundColor Green
    Write-Host "  Workspace Name: $($publicInfo.data.name)" -ForegroundColor Cyan
} catch {
    Write-Host "✗ Failed to access workspace via subdomain: $_" -ForegroundColor Red
}

Write-Host "`n=== All Tests Completed ===" -ForegroundColor Green
```

Run it with:
```powershell
.\test-multitenant.ps1
```

---

## Verification Checklist

- [ ] Health check endpoint works
- [ ] Hostname availability check works
- [ ] Workspace creation from base domain works
- [ ] Workspace creation from subdomain is blocked
- [ ] Workspace is accessible via subdomain URL
- [ ] Cookies are set with correct domain (`.wiki.weseegpt.com`)
- [ ] Multiple workspaces can be created
- [ ] Workspace isolation works (data doesn't leak between workspaces)
- [ ] Duplicate email is rejected
- [ ] Disallowed hostnames are rejected

---

## Troubleshooting

### Issue: "Workspace creation is only allowed from the base domain"

**Solution**: Make sure you're calling the API from `wiki.weseegpt.com:3000`, not from a subdomain.

### Issue: "An account with this email already exists"

**Solution**: Use a different email address for testing.

### Issue: Hostname not available

**Solution**: 
- Check if hostname is in DISALLOWED_HOSTNAMES list
- Check if hostname is already taken
- Try a different hostname

### Issue: Cookie not persisting

**Solution**:
- Verify cookie domain is set to `.wiki.weseegpt.com`
- Check browser cookie settings
- Ensure `secure: false` for HTTP in development

---

## Next Steps

After successful testing:

1. **Create production workspace** with your actual domain
2. **Configure DNS** with wildcard record: `*.wiki.weseegpt.com A → Your Server IP`
3. **Set up SSL certificate** for `*.wiki.weseegpt.com`
4. **Update environment variables** for production
5. **Test in production environment**

---

## Support

For issues:
1. Check server logs for detailed error messages
2. Verify environment configuration
3. Check database for workspace records
4. Review domain middleware logs

