-- Indicators for the "Proposed System" column of Table 4.12, computed from the live database.
USE tenant_landlord;
-- % of requests that have a written record: 100% by construction (every request is a database row).
-- Average time to resolve a request (days) and number resolved:
SELECT COUNT(*) AS resolved, ROUND(AVG(TIMESTAMPDIFF(MINUTE, date_submitted, date_resolved))/1440, 2) AS avg_days_to_resolve
FROM MaintenanceRequests WHERE date_resolved IS NOT NULL;
-- Average time until the first response (first status change or message from landlord/staff), in hours:
SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, m.date_submitted, x.first_reply))/60, 2) AS avg_hours_to_first_response
FROM MaintenanceRequests m JOIN (
  SELECT request_id, MIN(timestamp) AS first_reply FROM Messages
  WHERE sender_id IN (SELECT user_id FROM Users WHERE role <> 'Tenant') GROUP BY request_id) x ON x.request_id = m.request_id;
-- Requests by status / category:
SELECT status, COUNT(*) FROM MaintenanceRequests GROUP BY status;
SELECT category, COUNT(*) FROM MaintenanceRequests GROUP BY category ORDER BY 2 DESC;
