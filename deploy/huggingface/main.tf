terraform {
  required_version = ">= 1.0"
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

variable "hf_token" {
  description = "Your Hugging Face user access token (Role: Write)"
  type        = string
  sensitive   = true
}

variable "space_name" {
  description = "Name for your Hugging Face Space"
  type        = string
  default     = "dataclaw"
}

variable "private" {
  description = "Whether the Space is private"
  type        = bool
  default     = false
}

variable "anthropic_api_key" {
  description = "Optional Anthropic API Key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "Optional OpenAI API Key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Optional Gemini API Key"
  type        = string
  default     = ""
  sensitive   = true
}

resource "null_resource" "deploy_hf_space" {
  triggers = {
    space_name = var.space_name
    private    = tostring(var.private)
    # Re-trigger on new git commit hash
    git_sha    = trimspace(fileexists("${path.module}/../../.git/HEAD") ? file("${path.module}/../../.git/HEAD") : "1")
  }

  provisioner "local-exec" {
    command = <<EOT
      set -e

      echo "🔍 Verifying Hugging Face Token..."
      WHOAMI_RESP=$(curl -sf -H "Authorization: Bearer ${var.hf_token}" https://huggingface.co/api/whoami-v2) || {
        echo "❌ Invalid Hugging Face Token. Please provide a token with 'Write' permissions."
        exit 1
      }

      HF_USER=$(echo "$WHOAMI_RESP" | grep -o '"name":"[^"]*' | head -1 | cut -d'"' -f4)
      echo "✅ Authenticated as Hugging Face user: $HF_USER"

      echo "📦 Creating Space '$HF_USER/${var.space_name}' (if it doesn't already exist)..."
      CREATE_RESP=$(curl -s -X POST \
        -H "Authorization: Bearer ${var.hf_token}" \
        -H "Content-Type: application/json" \
        -d '{"type": "space", "name": "${var.space_name}", "space_sdk": "docker", "private": ${var.private}}' \
        https://huggingface.co/api/repos/create)

      echo "🔑 Configuring secrets..."
      set_secret() {
        KEY=$1
        VAL=$2
        if [ -n "$VAL" ]; then
          curl -s -X POST \
            -H "Authorization: Bearer ${var.hf_token}" \
            -H "Content-Type: application/json" \
            -d "{\"key\":\"$KEY\",\"value\":\"$VAL\"}" \
            "https://huggingface.co/api/spaces/$HF_USER/${var.space_name}/secrets" > /dev/null || true
          echo "   - Configured secret: $KEY"
        fi
      }

      set_secret "ANTHROPIC_API_KEY" "${var.anthropic_api_key}"
      set_secret "OPENAI_API_KEY" "${var.openai_api_key}"
      set_secret "GEMINI_API_KEY" "${var.gemini_api_key}"

      echo "🚀 Deploying repository to Hugging Face..."
      cd "${path.module}/../.."
      
      REMOTE_URL="https://$HF_USER:${var.hf_token}@huggingface.co/spaces/$HF_USER/${var.space_name}"
      
      git push --force "$REMOTE_URL" HEAD:refs/heads/main
      
      echo "🎉 Deployment initiated successfully!"
EOT
  }
}

output "space_url" {
  description = "Your Hugging Face Space URL"
  value       = "https://huggingface.co/spaces/YOUR_USER/${var.space_name}"
}
