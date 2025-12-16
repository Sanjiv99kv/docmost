# Production Environment Configuration Guide for ECS

This guide explains how to configure Docmost for production deployment on AWS ECS with multi-tenant support.

## 🔧 Fixed Issues

### 1. PostgreSQL SSL Certificate Error
**Problem**: `SELF_SIGNED_CERT_IN_CHAIN` error when connecting to RDS PostgreSQL.

**Solution**: The database connection now supports SSL configuration via `sslmode` parameter in `DATABASE_URL`.

**Options**:
- `sslmode=require` - Requires SSL but accepts self-signed certificates (recommended for RDS)
- `sslmode=no-verify` - Explicitly disables certificate verification
- `sslmode=verify-ca` - Verifies certificate against CA
- `sslmode=verify-full` - Full certificate verification

### 2. Redis Connection Errors
**Problem**: Connection refused errors on port 6380 (Redis TLS).

**Solution**: 
- Added TLS support for `rediss://` URLs
- Improved error handling and logging
- Added connection timeouts

## 📋 Required Environment Variables

### Multi-Tenant Configuration
```env
CLOUD=true
SUBDOMAIN_HOST=wiki.weseegpt.com
APP_URL=https://wiki.weseegpt.com
```

### Environment
```env
NODE_ENV=production
PORT=3000
```

### Security (CRITICAL)
```env
# Generate with: openssl rand -base64 32
APP_SECRET=<GENERATE-A-SECURE-32-CHARACTER-OR-LONGER-SECRET>
```

### Database (RDS PostgreSQL)
```env
# For RDS with SSL (recommended)
DATABASE_URL=postgresql://username:password@your-rds-endpoint.region.rds.amazonaws.com:5432/docmost?schema=public&sslmode=require

# For RDS without SSL verification (if needed)
# DATABASE_URL=postgresql://username:password@your-rds-endpoint.region.rds.amazonaws.com:5432/docmost?schema=public&sslmode=no-verify

# Connection pool size (optional)
DATABASE_MAX_POOL=20
```

### Redis (ElastiCache)
```env
# For Redis without TLS
REDIS_URL=redis://your-elasticache-endpoint.cache.amazonaws.com:6379

# For Redis with TLS (ElastiCache with encryption)
REDIS_URL=rediss://your-elasticache-endpoint.cache.amazonaws.com:6380
```

### Storage (S3)
```env
STORAGE_DRIVER=s3
AWS_S3_ACCESS_KEY_ID=<your-aws-access-key>
AWS_S3_SECRET_ACCESS_KEY=<your-aws-secret-key>
AWS_S3_REGION=us-east-1
AWS_S3_BUCKET=docmost-uploads
```

### Email Configuration
```env
# Option 1: SMTP
MAIL_DRIVER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@wiki.weseegpt.com

# Option 2: Postmark
# MAIL_DRIVER=postmark
# POSTMARK_API_KEY=your-postmark-api-key
# POSTMARK_FROM=noreply@wiki.weseegpt.com
```

### Optional Configuration
```env
# Search
SEARCH_DRIVER=database

# File Upload Limits
FILE_UPLOAD_SIZE_LIMIT=50mb
FILE_IMPORT_SIZE_LIMIT=200mb

# Collaboration (if using separate server)
# COLLAB_URL=https://collab.wiki.weseegpt.com

# Analytics
# POSTHOG_HOST=https://app.posthog.com
# POSTHOG_KEY=your-posthog-key
```

## 🚀 ECS Deployment Checklist

### 1. Generate Secure Secrets
```bash
# Generate APP_SECRET
openssl rand -base64 32
```

### 2. Configure DNS
Set up wildcard DNS records:
```
*.wiki.weseegpt.com  CNAME  →  Your ECS ALB/CloudFront
wiki.weseegpt.com    CNAME  →  Your ECS ALB/CloudFront
```

### 3. SSL/TLS Certificate
- Request a wildcard certificate in AWS Certificate Manager (ACM): `*.wiki.weseegpt.com`
- Attach the certificate to your Application Load Balancer (ALB)
- Configure HTTPS listener on port 443
- Set up HTTP to HTTPS redirect

### 4. ECS Task Definition
Create or update your ECS task definition with:

**Container Environment Variables**:
- Set all required environment variables listed above
- Use AWS Secrets Manager or Parameter Store for sensitive values:
  - `APP_SECRET`
  - `DATABASE_URL`
  - `REDIS_URL`
  - `AWS_S3_SECRET_ACCESS_KEY`
  - `SMTP_PASSWORD` or `POSTMARK_API_KEY`

**Example Task Definition** (JSON snippet):
```json
{
  "containerDefinitions": [
    {
      "name": "docmost",
      "image": "your-ecr-repo/docmost:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "CLOUD",
          "value": "true"
        },
        {
          "name": "SUBDOMAIN_HOST",
          "value": "wiki.weseegpt.com"
        },
        {
          "name": "APP_URL",
          "value": "https://wiki.weseegpt.com"
        },
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "APP_SECRET",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:docmost/app-secret"
        },
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:docmost/database-url"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:docmost/redis-url"
        }
      ]
    }
  ]
}
```

### 5. Application Load Balancer Configuration
- **Listener**: HTTPS on port 443 with ACM certificate
- **Target Group**: 
  - Protocol: HTTP
  - Port: 3000
  - Health Check Path: `/api/health`
  - Health Check Protocol: HTTP
  - Health Check Interval: 30 seconds
  - Healthy Threshold: 2
  - Unhealthy Threshold: 3

### 6. Security Groups
**ECS Task Security Group**:
- Allow inbound from ALB security group on port 3000
- Allow outbound to:
  - RDS security group on port 5432
  - ElastiCache security group on port 6379 (or 6380 for TLS)
  - S3 endpoints
  - Internet for external APIs (email, etc.)

**ALB Security Group**:
- Allow inbound from 0.0.0.0/0 on port 443 (HTTPS)
- Allow inbound from 0.0.0.0/0 on port 80 (HTTP redirect)
- Allow outbound to ECS task security group on port 3000

### 7. RDS Configuration
- **Engine**: PostgreSQL 16 or later
- **SSL**: Enable SSL/TLS encryption
- **Security Group**: Allow inbound from ECS task security group on port 5432
- **Connection String Format**: 
  ```
  postgresql://username:password@rds-endpoint:5432/docmost?schema=public&sslmode=require
  ```

### 8. ElastiCache Configuration
- **Engine**: Redis 7.x
- **Encryption**: Enable encryption in transit (TLS) if using `rediss://`
- **Security Group**: Allow inbound from ECS task security group on port 6379 (or 6380 for TLS)
- **Connection String Format**:
  - Without TLS: `redis://elasticache-endpoint:6379`
  - With TLS: `rediss://elasticache-endpoint:6380`

### 9. S3 Bucket Configuration
- Create bucket: `docmost-uploads` (or your preferred name)
- Configure CORS if needed for direct uploads
- Set up IAM policy for ECS task role to access S3

**IAM Policy Example**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::docmost-uploads",
        "arn:aws:s3:::docmost-uploads/*"
      ]
    }
  ]
}
```

## 🔍 Troubleshooting

### Database Connection Issues
1. **SSL Certificate Error**: Add `&sslmode=require` to `DATABASE_URL`
2. **Connection Timeout**: Check security groups and RDS endpoint
3. **Authentication Failed**: Verify username/password in connection string

### Redis Connection Issues
1. **Connection Refused**: 
   - Verify `REDIS_URL` is set correctly
   - Check security groups allow port 6379/6380
   - Ensure ElastiCache endpoint is correct
2. **TLS Errors**: Use `rediss://` protocol for encrypted connections

### Cookie Issues
1. **Cookies Not Set**: Verify `APP_URL` uses `https://` protocol
2. **Cross-Subdomain Issues**: Ensure cookie domain is `.wiki.weseegpt.com`
3. **SameSite Errors**: Already configured as `Lax` in code

### DNS Issues
1. **Subdomain Not Resolving**: Verify wildcard DNS record `*.wiki.weseegpt.com`
2. **SSL Certificate Errors**: Ensure ACM certificate covers `*.wiki.weseegpt.com`

## 📝 Quick Reference

### Environment Variable Summary
| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `CLOUD` | Yes | `true` | Enable multi-tenant mode |
| `SUBDOMAIN_HOST` | Yes | `wiki.weseegpt.com` | Base domain (no protocol) |
| `APP_URL` | Yes | `https://wiki.weseegpt.com` | Full URL with protocol |
| `APP_SECRET` | Yes | `(32+ chars)` | Generate secure random string |
| `DATABASE_URL` | Yes | `postgresql://...&sslmode=require` | Include `sslmode` for RDS |
| `REDIS_URL` | Yes | `redis://...` or `rediss://...` | Use `rediss://` for TLS |
| `NODE_ENV` | Yes | `production` | Production mode |
| `STORAGE_DRIVER` | Yes | `s3` | Use S3 for production |
| `MAIL_DRIVER` | Recommended | `smtp` or `postmark` | Email notifications |

### SSL Mode Options for PostgreSQL
- `require` - Requires SSL, accepts self-signed (recommended for RDS)
- `no-verify` - Requires SSL, no certificate verification
- `verify-ca` - Verifies certificate against CA
- `verify-full` - Full certificate and hostname verification

### Redis URL Formats
- `redis://host:port` - Standard Redis connection
- `rediss://host:port` - Redis with TLS encryption
- `redis://host:port/db` - With database number
- `redis://:password@host:port` - With password

## ✅ Post-Deployment Verification

1. **Health Check**: `https://wiki.weseegpt.com/api/health`
2. **Base Domain**: `https://wiki.weseegpt.com` - Should show workspace creation page
3. **Subdomain**: `https://test.wiki.weseegpt.com` - Should show workspace login
4. **Create Workspace**: Test workspace creation flow
5. **Login**: Test login from subdomain
6. **Cookies**: Verify `authToken` cookie is set with domain `.wiki.weseegpt.com`

## 🆘 Support

If you encounter issues:
1. Check ECS task logs in CloudWatch
2. Verify all environment variables are set correctly
3. Check security group rules
4. Verify DNS and SSL certificate configuration
5. Review database and Redis connection strings

