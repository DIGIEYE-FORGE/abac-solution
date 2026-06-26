DROP INDEX IF EXISTS idx_logs_event_id_unique;
DROP INDEX IF EXISTS idx_logs_request_id;
DROP INDEX IF EXISTS idx_logs_event_type;
DROP INDEX IF EXISTS idx_logs_resource_id;

ALTER TABLE logs DROP COLUMN IF EXISTS event_id;
ALTER TABLE logs DROP COLUMN IF EXISTS request_id;
ALTER TABLE logs DROP COLUMN IF EXISTS event_type;
ALTER TABLE logs DROP COLUMN IF EXISTS resource_id;