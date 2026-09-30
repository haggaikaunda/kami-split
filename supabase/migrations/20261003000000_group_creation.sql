-- ADR-006: additive metadata and permanent identity-scoped creation receipts.
SET ROLE kami_migrator;
CREATE TABLE app.group_trip (
 group_id uuid PRIMARY KEY REFERENCES app.groups(id),
 destination text NOT NULL DEFAULT '' CHECK(char_length(destination)<=200),
 start_date date NOT NULL CHECK(start_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 end_date date NOT NULL CHECK(end_date BETWEEN start_date AND DATE '9999-12-31')
);
CREATE FUNCTION app.trip_household_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Serialize metadata insertion against designation changes too.
 PERFORM singleton FROM app.installation FOR SHARE;
 IF EXISTS(SELECT FROM app.installation WHERE household_group_id=NEW.group_id) THEN
  RAISE EXCEPTION 'household must be ordinary' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_household_guard BEFORE INSERT OR UPDATE ON app.group_trip
FOR EACH ROW EXECUTE FUNCTION app.trip_household_guard();
CREATE FUNCTION app.household_trip_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT FROM app.group_trip WHERE group_id=NEW.household_group_id) THEN
  RAISE EXCEPTION 'household must be ordinary' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_trip_guard BEFORE INSERT OR UPDATE ON app.installation
FOR EACH ROW EXECUTE FUNCTION app.household_trip_guard();
CREATE TABLE app.group_creation_attempts (
 creator_user_id uuid NOT NULL REFERENCES app.users(id),
 operation text NOT NULL DEFAULT 'CREATE_GROUP' CHECK(operation='CREATE_GROUP'),
 operation_key uuid NOT NULL,
 canonical_input jsonb NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('COMPLETED','REJECTED')),
 field_errors jsonb NOT NULL,
 group_id uuid REFERENCES app.groups(id) DEFERRABLE INITIALLY DEFERRED,
 owner_membership_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(creator_user_id,operation,operation_key),
 FOREIGN KEY(owner_membership_id,group_id) REFERENCES app.memberships(id,group_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((outcome='COMPLETED' AND group_id IS NOT NULL AND owner_membership_id IS NOT NULL AND field_errors='[]'::jsonb)
    OR (outcome='REJECTED' AND group_id IS NULL AND owner_membership_id IS NULL AND jsonb_typeof(field_errors)='array' AND jsonb_array_length(field_errors)>0))
);
ALTER TABLE app.group_trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.group_creation_attempts ENABLE ROW LEVEL SECURITY;
-- No blanket writes, direct receipt reads, browser grants, expiry, or pruning.
CREATE POLICY group_trip_read ON app.group_trip FOR SELECT TO kami_api USING(app.can_read_group(group_id));
GRANT SELECT ON app.group_trip TO kami_api;
CREATE FUNCTION app.group_creator_lock() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000';
 END IF;
 SELECT id INTO actor FROM app.users WHERE auth_subject=app.verified_subject()
  AND enabled AND live_auth_id=auth_subject FOR SHARE;
 IF actor IS NULL THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 PERFORM singleton FROM app.installation WHERE group_creator_user_id=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION app.group_creation_result(a app.group_creation_attempts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN a.outcome='COMPLETED' AND NOT app.can_read_group(a.group_id)
 THEN jsonb_build_object('state','NOT_FOUND') ELSE
 jsonb_build_object('state',a.outcome,'groupId',a.group_id,'ownerMembershipId',a.owner_membership_id,
 'fieldErrors',a.field_errors,'createdAt',a.created_at) END;
$$;
CREATE FUNCTION app.group_creation_operation(key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; a app.group_creation_attempts;
BEGIN
 actor:=app.group_creator_lock();
 IF key IS NULL THEN RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM app.group_creation_attempts WHERE creator_user_id=actor AND operation='CREATE_GROUP' AND operation_key=key;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','NOT_STARTED'); END IF;
 RETURN app.group_creation_result(a);
END $$;
CREATE FUNCTION app.create_group(key uuid, group_name text, kind text, trip jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 actor uuid; canonical jsonb; errors jsonb:='[]'::jsonb; destination text; starts date; ends date;
 a app.group_creation_attempts; inserted integer; new_group uuid; new_owner uuid;
BEGIN
 actor:=app.group_creator_lock();
 IF key IS NULL OR group_name IS NULL OR kind IS NULL OR kind NOT IN ('ORDINARY','TRIP') THEN
  RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023';
 END IF;
 group_name:=btrim(group_name,E' \t\r\n');
 IF trip='null'::jsonb THEN trip:=NULL; END IF;
 IF trip IS NOT NULL THEN
  IF jsonb_typeof(trip)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(trip) k WHERE k NOT IN ('destination','startDate','endDate'))
   OR NOT (trip ? 'startDate' AND trip ? 'endDate')
   OR jsonb_typeof(trip->'startDate')<>'string' OR jsonb_typeof(trip->'endDate')<>'string'
   OR (trip ? 'destination' AND jsonb_typeof(trip->'destination') NOT IN ('string','null')) THEN
   RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023';
  END IF;
  destination:=coalesce(trip->>'destination','');
  IF (trip->>'startDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (trip->>'endDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023';
  END IF;
  BEGIN
   starts:=(trip->>'startDate')::date; ends:=(trip->>'endDate')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
   RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023';
  END;
  IF starts NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR ends NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN
   RAISE EXCEPTION 'invalid scalar' USING ERRCODE='22023';
  END IF;
  trip:=jsonb_build_object('destination',destination,'startDate',trip->>'startDate','endDate',trip->>'endDate');
 END IF;
 canonical:=jsonb_build_object('operation','CREATE_GROUP','name',group_name,'kind',kind,'trip',trip);
 IF char_length(group_name) NOT BETWEEN 1 AND 120 THEN errors:=errors||jsonb_build_array(jsonb_build_object('field','name','code','LENGTH')); END IF;
 IF (kind='ORDINARY' AND trip IS NOT NULL) OR (kind='TRIP' AND trip IS NULL) THEN errors:=errors||jsonb_build_array(jsonb_build_object('field','trip','code','KIND')); END IF;
 IF char_length(destination)>200 THEN errors:=errors||jsonb_build_array(jsonb_build_object('field','trip.destination','code','LENGTH')); END IF;
 IF ends<starts THEN errors:=errors||jsonb_build_array(jsonb_build_object('field','trip.endDate','code','ORDER')); END IF;
 IF errors='[]'::jsonb THEN new_group:=gen_random_uuid(); new_owner:=gen_random_uuid(); END IF;
 -- Unique insertion waits for a concurrent same-key transaction. The result
 -- points forward through deferred FKs; any later statement failure rolls back
 -- this entire function, including its receipt. No PENDING row can commit.
 INSERT INTO app.group_creation_attempts(creator_user_id,operation_key,canonical_input,outcome,field_errors,group_id,owner_membership_id)
 VALUES(actor,key,canonical,CASE WHEN errors='[]'::jsonb THEN 'COMPLETED' ELSE 'REJECTED' END,errors,new_group,new_owner)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO a FROM app.group_creation_attempts WHERE creator_user_id=actor AND operation='CREATE_GROUP' AND operation_key=key FOR UPDATE;
 IF a.canonical_input<>canonical THEN RETURN jsonb_build_object('state','OPERATION_CONFLICT'); END IF;
 IF inserted=1 AND a.outcome='COMPLETED' THEN
  INSERT INTO app.groups(id,name,owner_membership_id) VALUES(new_group,group_name,new_owner);
  INSERT INTO app.memberships(id,group_id,user_id) VALUES(new_owner,new_group,actor);
  IF kind='TRIP' THEN INSERT INTO app.group_trip(group_id,destination,start_date,end_date) VALUES(new_group,destination,starts,ends); END IF;
 END IF;
 RETURN app.group_creation_result(a);
END $$;
GRANT EXECUTE ON FUNCTION app.create_group(uuid,text,text,jsonb), app.group_creation_operation(uuid) TO kami_api;
RESET ROLE;
