#!/bin/bash
# KIND + Podman Installation Script
# This script automates the setup of Kubernetes in Docker with Podman

set -e  # Exit on error

echo "=== KIND + Podman Installation Script ==="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on Linux
if [[ ! "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "${RED}Error: This script is designed for Linux systems${NC}"
    exit 1
fi

# Detect Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo -e "${RED}Error: Cannot detect Linux distribution${NC}"
    exit 1
fi

echo "Detected OS: $OS $VER"
echo ""

# Step 1: Install Podman
echo -e "${YELLOW}Step 1: Installing Podman...${NC}"
if command -v podman &> /dev/null; then
    echo -e "${GREEN}✓ Podman is already installed${NC}"
    podman --version
else
    if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
        echo "Installing Podman via apt..."
        sudo apt-get update
        sudo apt-get install -y podman podman-docker
    elif [[ "$OS" == "fedora" ]] || [[ "$OS" == "rhel" ]] || [[ "$OS" == "centos" ]]; then
        echo "Installing Podman via dnf..."
        sudo dnf install -y podman
    else
        echo -e "${YELLOW}Unsupported distribution. Please install Podman manually.${NC}"
        echo "Visit: https://podman.io/docs/installation"
        exit 1
    fi
    echo -e "${GREEN}✓ Podman installed successfully${NC}"
fi

echo ""

# Step 2: Verify Podman works
echo -e "${YELLOW}Step 2: Verifying Podman...${NC}"
if podman run --rm hello-world > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Podman is working correctly${NC}"
else
    echo -e "${RED}✗ Podman test failed${NC}"
    exit 1
fi

echo ""

# Step 3: Set up rootless Podman
echo -e "${YELLOW}Step 3: Setting up rootless Podman...${NC}"

if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
    sudo apt-get install -y uidmap
elif [[ "$OS" == "fedora" ]] || [[ "$OS" == "rhel" ]]; then
    sudo dnf install -y uidmap
fi

# Enable user namespace delegation
if ! grep -q "user.max_user_namespaces" /etc/sysctl.conf; then
    echo "Enabling user namespaces..."
    sudo sh -c 'echo "user.max_user_namespaces=28633" >> /etc/sysctl.conf'
    sudo sysctl -p > /dev/null
    echo -e "${GREEN}✓ User namespaces enabled${NC}"
else
    echo -e "${GREEN}✓ User namespaces already enabled${NC}"
fi

echo ""

# Step 4: Install Go (if needed for KIND installation)
echo -e "${YELLOW}Step 4: Checking Go installation...${NC}"
if command -v go &> /dev/null; then
    echo -e "${GREEN}✓ Go is already installed${NC}"
    go version
else
    echo -e "${YELLOW}Go is not installed. KIND can still be installed via binary.${NC}"
    read -p "Install Go? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        GO_VERSION="1.21.0"
        echo "Downloading Go $GO_VERSION..."
        curl -L https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz -o /tmp/go.tar.gz
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf /tmp/go.tar.gz
        rm /tmp/go.tar.gz
        echo -e "${GREEN}✓ Go installed successfully${NC}"
        echo "Add to PATH: export PATH=\$PATH:/usr/local/go/bin"
    fi
fi

echo ""

# Step 5: Install KIND
echo -e "${YELLOW}Step 5: Installing KIND...${NC}"
if command -v kind &> /dev/null; then
    echo -e "${GREEN}✓ KIND is already installed${NC}"
    kind version
else
    echo "Downloading KIND..."
    if command -v go &> /dev/null; then
        # Install via Go
        go install sigs.k8s.io/kind@latest
        export PATH=$PATH:$(go env GOPATH)/bin
        echo -e "${GREEN}✓ KIND installed via Go${NC}"
    else
        # Install via binary
        KIND_VERSION="v0.20.0"
        curl -Lo /tmp/kind https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64
        chmod +x /tmp/kind
        sudo mv /tmp/kind /usr/local/bin/kind
        echo -e "${GREEN}✓ KIND installed via binary${NC}"
    fi
fi

echo ""

# Step 6: Install kubectl
echo -e "${YELLOW}Step 6: Checking kubectl...${NC}"
if command -v kubectl &> /dev/null; then
    echo -e "${GREEN}✓ kubectl is already installed${NC}"
    kubectl version --client
else
    echo "Installing kubectl..."
    if [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
        sudo apt-get install -y kubectl
    elif [[ "$OS" == "fedora" ]]; then
        sudo dnf install -y kubernetes-client
    else
        echo -e "${YELLOW}Please install kubectl manually${NC}"
        echo "Visit: https://kubernetes.io/docs/tasks/tools/"
    fi
    echo -e "${GREEN}✓ kubectl installed${NC}"
fi

echo ""

# Step 7: Configure KIND for Podman
echo -e "${YELLOW}Step 7: Configuring KIND for Podman...${NC}"

# Add to shell profile
SHELL_RC=""
if [ -f ~/.bashrc ]; then
    SHELL_RC=~/.bashrc
elif [ -f ~/.zshrc ]; then
    SHELL_RC=~/.zshrc
fi

if [ ! -z "$SHELL_RC" ]; then
    if ! grep -q "KIND_EXPERIMENTAL_PROVIDER=podman" "$SHELL_RC"; then
        echo 'export KIND_EXPERIMENTAL_PROVIDER=podman' >> "$SHELL_RC"
        echo -e "${GREEN}✓ Added KIND_EXPERIMENTAL_PROVIDER to $SHELL_RC${NC}"
    else
        echo -e "${GREEN}✓ KIND_EXPERIMENTAL_PROVIDER already configured${NC}"
    fi
fi

# Export for current session
export KIND_EXPERIMENTAL_PROVIDER=podman

echo ""

# Step 8: Create config directory
echo -e "${YELLOW}Step 8: Creating configuration directory...${NC}"
mkdir -p ~/.kind
echo -e "${GREEN}✓ Config directory created at ~/.kind${NC}"

echo ""

# Step 9: Create sample cluster config
echo -e "${YELLOW}Step 9: Creating sample cluster configurations...${NC}"

# Simple single-node config
cat > ~/.kind/single-node.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: mycelia-single
nodes:
  - role: control-plane
EOF

# Multi-node config
cat > ~/.kind/multi-node.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: mycelia-multi
nodes:
  - role: control-plane
  - role: worker
  - role: worker
EOF

echo -e "${GREEN}✓ Sample configurations created${NC}"
echo "  - Single node: ~/.kind/single-node.yaml"
echo "  - Multi node:  ~/.kind/multi-node.yaml"

echo ""

# Step 10: Summary
echo -e "${GREEN}=== Installation Complete ===${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Load the environment variables:"
echo "   source ~/.bashrc  (or ~/.zshrc)"
echo ""
echo "2. Create your first cluster:"
echo "   kind create cluster --name mycelia --config ~/.kind/single-node.yaml"
echo ""
echo "3. Verify the cluster:"
echo "   kubectl cluster-info"
echo "   kubectl get nodes"
echo ""
echo "4. Access cluster kubeconfig:"
echo "   kind get kubeconfig --name mycelia"
echo ""
echo "For more information, see: docs/KIND-PODMAN-SETUP.md"
echo ""
