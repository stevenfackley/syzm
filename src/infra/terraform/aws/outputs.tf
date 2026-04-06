output "brain_security_group_id" {
  value = aws_security_group.brain.id
}

output "brain_asg_name" {
  value = aws_autoscaling_group.brain.name
}

