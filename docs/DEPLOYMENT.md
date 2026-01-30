# Deploying Video Transcriber to Railway

This guide walks through deploying the Video Transcriber app to Railway.

## Prerequisites

- [Railway account](https://railway.app)
- [Railway CLI](https://docs.railway.app/develop/cli) installed
- Git repository with the code
- API keys for AssemblyAI and Anthropic

---

## Quick Deploy

### 1. Login to Railway

```bash
railway login
```

### 2. Initialize Project

```bash
cd /path/to/video-transcriber
railway init
```

Select "Empty Project" when prompted.

### 3. Set Environment Variables

```bash
# Required
railway variable set ASSEMBLYAI_API_KEY=your_key
railway variable set ANTHROPIC_API_KEY=your_key

# Recommended
railway variable set ADMIN_PASSWORD=your_secure_password
railway variable set NODE_ENV=production

# Optional - rate limits
railway variable set MAX_GLOBAL_CONCURRENT=10
railway variable set MAX_USER_CONCURRENT=3
railway variable set MAX_USER_QUEUE=10
```

### 4. Deploy

```bash
railway up
```

### 5. Generate Domain

```bash
railway domain
```

This generates a public URL like `https://your-app.up.railway.app`.

---

## Adding PostgreSQL (Optional)

For persistent storage:

### 1. Add PostgreSQL Plugin

```bash
railway add
```

Select "PostgreSQL" from the list.

### 2. Verify Connection

The `DATABASE_URL` environment variable is automatically set. The app will detect it and connect.

### 3. Redeploy

```bash
railway up
```

---

## Configuration Files

### railway.json

Create `railway.json` in the project root for custom settings:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "sleepApplication": false,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Key Settings

- **sleepApplication: false** - Prevents the app from sleeping after inactivity (Pro plan feature)
- **restartPolicyType: ON_FAILURE** - Auto-restart on crashes
- **restartPolicyMaxRetries: 10** - Max restart attempts

---

## Monitoring

### View Logs

```bash
# Real-time logs
railway logs -f

# Build logs
railway logs --build
```

### Check Status

```bash
railway status
```

### Open Dashboard

```bash
railway open
```

---

## Troubleshooting

### Common Issues

#### 1. "No video file uploaded" Error

**Cause:** MIME type mismatch between client and server.

**Fix:** Ensure the server accepts all required MIME types in multer config:

```javascript
const allowed = [
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/wav',
  'audio/mp4', 'audio/x-m4a'
];
```

#### 2. FFmpeg Not Working

**Cause:** SharedArrayBuffer requires specific headers.

**Fix:** Ensure COOP/COEP headers are set:

```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

#### 3. Upload Timeouts

**Cause:** Large files timing out before upload completes.

**Fix:** Server timeouts are set to 10 minutes. For larger files, encourage client-side audio extraction.

#### 4. Database Connection Failed

**Cause:** Database not provisioned or wrong connection string.

**Fix:**
1. Run `railway add` to add PostgreSQL
2. Check `DATABASE_URL` is set: `railway variable list`
3. Redeploy: `railway up`

#### 5. Rate Limit Errors

**Cause:** User exceeded queue limits.

**Fix:** Adjust limits via environment variables or wait for jobs to complete.

---

## Updating the Deployment

### Push Updates

```bash
# Make changes locally
# Test locally with: npm start

# Deploy updates
railway up
```

### Rollback

Use the Railway dashboard to rollback to a previous deployment if issues occur.

---

## Cost Considerations

### Railway

- **Free tier:** $5 credit/month
- **Pro plan:** $20/month base + usage
- **Database:** PostgreSQL included with compute costs

### AssemblyAI

- **Pay-per-use:** ~$0.65 per hour of audio
- **Free tier:** Limited hours for testing

### Anthropic (Claude)

- **Pay-per-use:** Varies by model
- **Claude Opus 4.5:** ~$15 per 1M input tokens, ~$75 per 1M output tokens

### Recommendations

1. Use client-side audio extraction to reduce AssemblyAI costs
2. Set appropriate rate limits to control API usage
3. Monitor usage in Railway dashboard and API provider dashboards

---

## Security Checklist

Before going live:

- [ ] Change `ADMIN_PASSWORD` from default
- [ ] Set `NODE_ENV=production`
- [ ] Review rate limits for your expected traffic
- [ ] Enable Railway's built-in DDoS protection
- [ ] Consider adding authentication if needed
- [ ] Monitor logs for suspicious activity

---

## Custom Domain (Optional)

### 1. Add Custom Domain in Railway

```bash
railway domain add yourdomain.com
```

### 2. Configure DNS

Add a CNAME record pointing to your Railway domain:

```
Type: CNAME
Name: @ (or subdomain)
Value: your-app.up.railway.app
```

### 3. Wait for SSL

Railway automatically provisions SSL certificates. This may take a few minutes.

---

## Support

- [Railway Documentation](https://docs.railway.app)
- [Railway Discord](https://discord.gg/railway)
- [AssemblyAI Documentation](https://www.assemblyai.com/docs)
- [Anthropic Documentation](https://docs.anthropic.com)
