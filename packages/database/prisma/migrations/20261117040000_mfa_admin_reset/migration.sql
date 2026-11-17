-- Number of ACTIVE workspaces a user belongs to. Needed to decide whether a workspace admin may reset the user's two-step
-- verification: MFA is account-wide, so a reset must not weaken the user's other workspaces. Returns a count only.
CREATE OR REPLACE FUNCTION user_active_workspace_count(p_user uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND t.status <> 'DELETED';
$$;
REVOKE ALL ON FUNCTION user_active_workspace_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_active_workspace_count(uuid) TO leadpilot_app;
