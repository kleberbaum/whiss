#!/bin/bash

# Set the URL for the docker-compose file
DOCKER_COMPOSE_FILE_URL="https://raw.githubusercontent.com/tarasglek/ssh-via-cloudflare-tunnel/refs/heads/main/docker-compose.yml"

# Function to install Docker Compose
install_docker_compose() {
  echo "Installing Docker Compose..."

  # Download the latest version of Docker Compose
  DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -Po '"tag_name": "\K.*\d')

  sudo curl -L "https://github.com/docker/compose/releases/download/$DOCKER_COMPOSE_VERSION/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

  # Apply executable permissions to the binary
  sudo chmod +x /usr/local/bin/docker-compose

  echo "Docker Compose installed successfully."
}

# Check if Docker and curl are installed
if ! command -v docker &> /dev/null
then
  echo "Docker is not installed. Please install Docker first."
  exit 1
fi

if ! command -v curl &> /dev/null
then
  echo "curl is not installed. Please install curl first."
  exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
  install_docker_compose
else
  echo "Docker Compose is already installed."
fi

# Download and run the docker-compose.yml file without saving it
echo "Running docker-compose up from $DOCKER_COMPOSE_FILE_URL..."

curl -sSL $DOCKER_COMPOSE_FILE_URL | docker-compose -f - up

if [ $? -ne 0 ]; then
  echo "docker-compose up failed."
  exit 1
fi

echo "Done."
