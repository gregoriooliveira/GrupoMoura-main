#!/bin/bash

# Script para construir imagens Docker localmente (sem push)
# Útil para desenvolvimento e testes locais

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações
BACKEND_IMAGE="fernandodumont/nodejs-lab-backend"
ROBOT_IMAGE="fernandodumont/nodejs-lab-robot"
VERSION="${1:-latest}"
MODE="${2:-all}"  # all, list, backend, frontend
PLATFORM="${3:-linux/arm64}"

echo -e "${GREEN}=== Build de Imagens Docker (Local) ===${NC}"
echo -e "${YELLOW}Versão: ${VERSION}${NC}"
echo -e "${YELLOW}Plataforma: ${PLATFORM}${NC}"
echo -e "${YELLOW}Modo: ${MODE}${NC}"
echo ""

# Função para listar imagens que seriam criadas
list_images() {
    local mode_to_check="${1:-all}"
    echo -e "${GREEN}=== Imagens que seriam criadas ===${NC}"
    if [[ "$mode_to_check" == "all" ]] || [[ "$mode_to_check" == "backend" ]]; then
        echo "  - ${BACKEND_IMAGE}:${VERSION}"
        echo "  - ${BACKEND_IMAGE}:latest"
    fi
    if [[ "$mode_to_check" == "all" ]] || [[ "$mode_to_check" == "robot" ]]; then
        echo "  - ${ROBOT_IMAGE}:${VERSION}"
        echo "  - ${ROBOT_IMAGE}:latest"
    fi
    echo ""
}

# Se modo for "list", apenas listar e sair
if [[ "$MODE" == "list" ]]; then
    list_images "all"
    exit 0
fi

# Build do Backend
if [[ "$MODE" == "all" ]] || [[ "$MODE" == "backend" ]]; then
    echo -e "${GREEN}=== Construindo Backend ===${NC}"
    cd backend
    docker build \
        --platform "$PLATFORM" \
        --tag "${BACKEND_IMAGE}:${VERSION}" \
        --tag "${BACKEND_IMAGE}:latest" \
        .
    cd ..
fi

# Build do Frontend
if [[ "$MODE" == "all" ]] || [[ "$MODE" == "robot" ]]; then
    echo ""
    echo -e "${GREEN}=== Construindo Robot ===${NC}"
    cd robot
    docker build \
        --platform "$PLATFORM" \
        --tag "${ROBOT_IMAGE}:${VERSION}" \
        --tag "${ROBOT_IMAGE}:latest" \
        .
    cd ..
fi

echo ""
echo -e "${GREEN}=== Build Concluído! ===${NC}"
echo -e "${YELLOW}Imagens criadas localmente:${NC}"
if [[ "$MODE" == "all" ]] || [[ "$MODE" == "backend" ]]; then
    echo "  - ${BACKEND_IMAGE}:${VERSION}"
    echo "  - ${BACKEND_IMAGE}:latest"
fi
if [[ "$MODE" == "all" ]] || [[ "$MODE" == "robot" ]]; then
    echo "  - ${ROBOT_IMAGE}:${VERSION}"
    echo "  - ${ROBOT_IMAGE}:latest"
fi
echo ""
echo -e "${YELLOW}Para usar com docker-compose:${NC}"
echo "  docker-compose up -d"
echo ""
echo -e "${YELLOW}Uso:${NC}"
echo "  ./build-images-local.sh [versão] [plataforma] [modo]"
echo "  Modos disponíveis:"
echo "    all      - Cria imagens de todos os componentes (padrão)"
echo "    list     - Lista quais imagens seriam criadas"
echo "    backend  - Cria apenas a imagem do backend"
echo "    robot - Cria apenas a imagem do robot"