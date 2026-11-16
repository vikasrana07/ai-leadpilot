-- Users can delete their own tasks (RLS still restricts to the tenant).
GRANT DELETE ON tasks TO leadpilot_app;
