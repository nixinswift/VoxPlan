DO $do$ BEGIN
EXECUTE replace(pg_get_functiondef('private.seed_mechanical_demo(uuid)'::regprocedure),
 'INSERT INTO project_members(project_id,user_id,role) VALUES (pid,_uid,''owner'');',
 'INSERT INTO project_members(project_id,user_id,role) VALUES (pid,_uid,''owner'') ON CONFLICT (project_id,user_id) DO NOTHING;');
END $do$;