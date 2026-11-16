-- Phase 4: RLS, grants and indexes for AI tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_assistants','ai_runs','ai_tool_executions','knowledge_documents','knowledge_chunks','scoring_rule_sets','lead_scores']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO leadpilot_app USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON ai_assistants, ai_runs, knowledge_documents, scoring_rule_sets TO leadpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_chunks TO leadpilot_app;
-- Append-only evidence trails.
GRANT SELECT, INSERT ON ai_tool_executions, lead_scores TO leadpilot_app;

-- At most ONE in-flight AI turn per conversation (the orchestrator relies on this as its lock).
CREATE UNIQUE INDEX ai_runs_one_running ON ai_runs (conversation_id) WHERE status = 'RUNNING';

-- Approximate nearest neighbours by cosine distance.
CREATE INDEX knowledge_chunks_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
