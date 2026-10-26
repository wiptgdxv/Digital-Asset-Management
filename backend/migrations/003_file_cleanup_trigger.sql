CREATE FUNCTION queue_deleted_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO file_cleanup(upload_id) VALUES(OLD.id) ON CONFLICT DO NOTHING;
 RETURN OLD;
END;
$$;
CREATE TRIGGER deleted_upload_cleanup AFTER DELETE ON upload_records
FOR EACH ROW EXECUTE FUNCTION queue_deleted_upload();
