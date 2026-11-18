# Monitoring infrastructure (examples)

**Everything here is an EXAMPLE. Nothing has been deployed to AWS and nothing here was validated by `cfn-lint` or by AWS** (the template was only parsed as YAML and reviewed by hand). Adjust and test it in a throwaway account first.

| File | What it is |
|---|---|
| `cloudwatch-alarms.example.yml` | CloudFormation: SNS topic with an email subscription, three log groups with retention, two log-based metrics (in-app alert lines, fatal crash lines), 15 alarms (application, load balancer, RDS, Redis), one optional ECS alarm. |

How it fits with the rest:
- The application already evaluates its own alert rules and emails platform admins (`docs/monitoring.md`). These alarms are a second channel plus the AWS resources the app cannot see.
- The log group names must match the `awslogs` settings in `infrastructure/ecs-fargate-reference.md`.
- An external probe of `/health/ready` is still required and is not part of this template: `docs/runbooks/external-uptime-probe.md`.
- Deploy: `aws cloudformation deploy --template-file infrastructure/monitoring/cloudwatch-alarms.example.yml --stack-name leadpilot-monitoring --parameter-overrides AlarmEmail=you@example.com AlbFullName=... ApiTargetGroupFullName=... RdsInstanceId=... RedisCacheClusterId=...` (untested command), then confirm the SNS email subscription.
- Cost notes are at the bottom of the template. Prices were not checked for any region.
