# Kubernetes Manifests for Mycelia

This directory contains Kubernetes manifests for deploying Mycelia to KIND (Kubernetes in Docker) with Podman.

## Directory Structure

```
k8s/
├── README.md                    # This file
├── mycelia-deployment.yaml      # Complete deployment manifests
└── [other manifest files]
```

## Prerequisites

1. **KIND cluster running with Podman**
   ```bash
   kind create cluster --name mycelia
   ```

2. **kubectl configured**
   ```bash
   kind get kubeconfig --name mycelia > ~/.kube/kind-mycelia
   export KUBECONFIG=~/.kube/kind-mycelia
   ```

3. **Docker/Podman images built**
   ```bash
   # Build images
   docker build -t mycelia-backend:latest ./backend
   docker build -t mycelia-frontend:latest ./frontend

   # Load into KIND
   kind load docker-image mycelia-backend:latest mycelia-frontend:latest --name mycelia
   ```

## Quick Start

### 1. Apply Manifests
```bash
# Apply all manifests
kubectl apply -f k8s/

# Or apply specific file
kubectl apply -f k8s/mycelia-deployment.yaml
```

### 2. Verify Deployment
```bash
# Check pods
kubectl get pods -n mycelia

# Watch rollout
kubectl rollout status deployment/mycelia-frontend -n mycelia
kubectl rollout status deployment/mycelia-backend -n mycelia

# Check services
kubectl get svc -n mycelia
```

### 3. Access Application

#### Option A: Port Forward
```bash
# Frontend
kubectl port-forward svc/mycelia-frontend 8080:80 -n mycelia

# Backend (separate terminal)
kubectl port-forward svc/mycelia-backend 5173:5173 -n mycelia

# MongoDB (if needed)
kubectl port-forward svc/mongodb 27017:27017 -n mycelia
```

Then access:
- Frontend: `http://localhost:8080`
- Backend: `http://localhost:5173`

#### Option B: Install Ingress Controller
```bash
# Install NGINX Ingress
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Wait for readiness
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=90s

# Add local hosts entry
echo "127.0.0.1 mycelia.local" | sudo tee -a /etc/hosts

# Port forward ingress
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 80:80
```

Then access:
- `http://mycelia.local/`
- `http://mycelia.local/api`

### 4. View Logs
```bash
# Frontend logs
kubectl logs -f deployment/mycelia-frontend -n mycelia

# Backend logs
kubectl logs -f deployment/mycelia-backend -n mycelia

# MongoDB logs
kubectl logs -f statefulset/mongodb -n mycelia
```

## Manifest Overview

### mycelia-deployment.yaml

Contains complete deployment setup:

**Namespace**
- Creates isolated `mycelia` namespace

**ConfigMap**
- Application configuration (LOG_LEVEL, etc.)

**Backend Deployment**
- 2 replicas by default
- Port 5173
- Health checks (liveness & readiness probes)
- Resource requests/limits

**Backend Service**
- ClusterIP service exposing backend internally

**Frontend Deployment**
- 2 replicas by default
- Port 80
- Configured to connect to backend

**Frontend Service**
- ClusterIP service exposing frontend internally

**MongoDB StatefulSet** (Optional)
- Single replica MongoDB instance
- Persistent storage
- Admin credentials via Secret

**MongoDB Service**
- Headless service for StatefulSet

**Ingress**
- Routes traffic to frontend and backend
- Requires ingress controller

**HorizontalPodAutoscalers**
- Auto-scale based on CPU utilization
- Min 2, Max 5 replicas

**NetworkPolicy** (Optional)
- Restricts traffic within namespace

## Customization

### Image Names
If your images have different names/registries:

```yaml
image: your-registry/mycelia-backend:latest
image: your-registry/mycelia-frontend:latest
```

### Resource Limits
Adjust CPU/memory based on your needs:

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### Replicas
Change default replica count:

```yaml
spec:
  replicas: 3  # Change from 2
```

### Environment Variables
Add custom env vars in deployment spec:

```yaml
env:
- name: MY_VAR
  value: "my-value"
- name: DB_URL
  value: "mongodb://admin:password@mongodb:27017/mycelia"
```

### MongoDB Credentials
Change default password in Secret:

```bash
kubectl edit secret mongodb-secret -n mycelia
```

Or update in YAML before applying:

```yaml
stringData:
  password: "your-secure-password"  # Change this
```

## Troubleshooting

### Pods Not Starting
```bash
# Check pod status
kubectl describe pod POD_NAME -n mycelia

# View logs
kubectl logs POD_NAME -n mycelia

# Check events
kubectl get events -n mycelia --sort-by='.lastTimestamp'
```

### Image Pull Errors
Ensure images are loaded into KIND:

```bash
# List images in cluster
podman images

# Load images
kind load docker-image mycelia-backend:latest --name mycelia
kind load docker-image mycelia-frontend:latest --name mycelia
```

### Service Connection Issues
```bash
# Test connectivity from pod
kubectl run -it --rm debug --image=busybox --restart=Never -- sh

# Inside pod, test:
nslookup mycelia-backend
wget http://mycelia-backend:5173/health
```

### Ingress Not Working
```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check ingress resource
kubectl get ingress -n mycelia
kubectl describe ingress mycelia-ingress -n mycelia
```

## Cleanup

### Delete Everything
```bash
# Delete entire namespace (cascades to all resources)
kubectl delete namespace mycelia

# Or specific resources
kubectl delete -f k8s/mycelia-deployment.yaml
```

### Delete KIND Cluster
```bash
kind delete cluster --name mycelia
```

## Advanced Topics

### Persistent Data
Currently uses emptyDir for MongoDB. For persistent data:

```yaml
volumeMounts:
- name: mongodb-storage
  mountPath: /data/db
volumes:
- name: mongodb-storage
  persistentVolumeClaim:
    claimName: mongodb-pvc
```

### Rolling Updates
Update image and rollout:

```bash
kubectl set image deployment/mycelia-backend \
  mycelia-backend=mycelia-backend:v2 \
  -n mycelia

# Monitor rollout
kubectl rollout status deployment/mycelia-backend -n mycelia

# Rollback if needed
kubectl rollout undo deployment/mycelia-backend -n mycelia
```

### Resource Monitoring
```bash
# Pod resource usage
kubectl top pods -n mycelia

# Node resource usage
kubectl top nodes
```

### Health Checks
Customize probe settings:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 5173
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

## References

- [KIND Documentation](https://kind.sigs.k8s.io/)
- [Kubernetes Manifests](https://kubernetes.io/docs/concepts/cluster-administration/manage-deployment/)
- [kubectl Cheatsheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [Deployment Guide](../docs/KIND-PODMAN-SETUP.md)
- [Quick Reference](../docs/KIND-PODMAN-CHEATSHEET.md)
