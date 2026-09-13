# Karajan Radar instance on GCP: infrastructure as code (KRD-TSK-0018).
#
# One instance = one apply of this module with its own variables. The module
# carries no project id, hostname or secret: those are variables, so the same
# description raises any number of instances. Mirrors packages/rag/deploy/gcp.

terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
