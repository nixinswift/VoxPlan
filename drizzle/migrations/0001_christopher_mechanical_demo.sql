CREATE OR REPLACE FUNCTION private.seed_mechanical_demo(_uid uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; s date := (date_trunc('week', now()) + interval '7 days')::date;
BEGIN
  SELECT id INTO pid FROM projects WHERE created_by=_uid AND name='Demo: Pump Station Piping Upgrade';
  IF pid IS NOT NULL THEN RETURN pid; END IF;
  INSERT INTO projects(name,description,created_by,is_demo)
  VALUES ('Demo: Pump Station Piping Upgrade','Practice project: heavy-industrial pump replacement with process piping, rigging, NDE, hydrotest and insulation. Edit freely.',_uid,false)
  RETURNING id INTO pid;
  INSERT INTO project_members(project_id,user_id,role) VALUES (pid,_uid,'owner');
  INSERT INTO tasks(user_id,project_id,name,trade,manpower,equipment,duration,start_date,notes) VALUES
  (_uid,pid,'Mobilization & site setup','general',4,'Pickup truck',2,s,'Laydown, toolcrib, permits'),
  (_uid,pid,'Equipment pad concrete (P-101A/B)','concrete',5,'Concrete pump',3,s+2,'2 pads 2.4 x 1.8 x 0.6 m'),
  (_uid,pid,'Set pumps P-101A/B','mechanical',4,'Hydraulic crane',2,s+7,'Rigging plan, critical lift review'),
  (_uid,pid,'Pipe spool install & welding','mechanical',8,'Welding machine',8,s+9,'NPS 8 Sch 40 CS, 38 butt welds'),
  (_uid,pid,'Pump alignment & grouting','mechanical',2,'Laser alignment kit',2,s+15,'Millwright'),
  (_uid,pid,'NDE / radiography','mechanical',2,'RT unit',2,s+17,'10% RT per spec'),
  (_uid,pid,'Hydrotest','mechanical',4,'Test pump',2,s+19,'1.5x design pressure'),
  (_uid,pid,'Pipe insulation & cladding','mechanical',4,'Scissor lift',4,s+21,'After hydrotest only'),
  (_uid,pid,'Electrical tie-in & motor bump','electrical',2,'None',1,s+25,'Rotation check'),
  (_uid,pid,'Commissioning & turnover','mechanical',3,'None',2,s+26,'Punch list, MDR');
  INSERT INTO estimates(project_id,user_id,category,description,quantity,length,width,thickness,height,unit,area,package,discipline,trade,uom,unit_qty,unit_cost) VALUES
  (pid,_uid,'footing','Pump pad P-101A/B',2,2.4,1.8,0.6,0,'m',0,'Pump Station','concrete','concrete','m3',0,0),
  (pid,_uid,'building','NPS 8 Sch 40 CS process pipe (line 8"-P-1001)',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','m',62,0),
  (pid,_uid,'building','NPS 8 butt welds',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','ea',38,0),
  (pid,_uid,'building','NPS 8 Class 150 gate valves',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','ea',4,0),
  (pid,_uid,'building','Set & align centrifugal pumps',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','ea',2,0),
  (pid,_uid,'building','Pipe insulation 50 mm with aluminium cladding',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','m',62,0),
  (pid,_uid,'building','Hydrotest',1,0,0,0,0,'m',0,'Mechanical & Plumbing','building','mechanical','ls',1,0);
  RETURN pid;
END $$;
REVOKE ALL ON FUNCTION private.seed_mechanical_demo(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.on_signup_seed_demo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'christopherbrogden@outlook.com' THEN
    BEGIN PERFORM private.seed_mechanical_demo(NEW.id);
    EXCEPTION WHEN others THEN RAISE WARNING 'demo seed failed: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.on_signup_seed_demo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS seed_demo_on_signup ON auth.users;
CREATE TRIGGER seed_demo_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.on_signup_seed_demo();