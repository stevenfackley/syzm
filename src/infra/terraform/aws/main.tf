terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.75"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_security_group" "brain" {
  name        = "${var.project_name}-brain-sg"
  description = "Security group for Syzm Brain"

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.brain_ingress_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_launch_template" "brain" {
  name_prefix   = "${var.project_name}-brain-"
  image_id      = var.ami_id
  instance_type = "c7g.large"

  vpc_security_group_ids = [aws_security_group.brain.id]

  user_data = base64encode(<<-EOT
    #!/bin/bash
    set -euxo pipefail
    # Placeholder bootstrap; replace with immutable image deployment.
    echo "Syzm Brain bootstrap" > /var/log/syzm-bootstrap.log
  EOT
  )
}

resource "aws_autoscaling_group" "brain" {
  name                = "${var.project_name}-brain-asg"
  max_size            = 3
  min_size            = 1
  desired_capacity    = 1
  vpc_zone_identifier = var.subnet_ids

  launch_template {
    id      = aws_launch_template.brain.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-brain"
    propagate_at_launch = true
  }
}

