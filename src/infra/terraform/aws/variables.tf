variable "project_name" {
  type        = string
  default     = "syzm"
  description = "Project name prefix"
}

variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS deployment region"
}

variable "ami_id" {
  type        = string
  description = "AMI used by launch template"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets for autoscaling group"
}

variable "brain_ingress_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "Allowed CIDRs for Brain service ingress"
}

