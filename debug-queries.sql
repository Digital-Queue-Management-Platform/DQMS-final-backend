-- Check existing alerts and feedback in the database
-- Run these queries in your database to verify the fix

-- 1. Check all alerts by type to see what's actually stored
SELECT type, severity, COUNT(*) as count, MAX(createdAt) as latest
FROM Alert
GROUP BY type, severity
ORDER BY latest DESC;

-- 2. Check recent feedback with ratings 1-3 to see assignment
SELECT 
  f.id,
  f.rating,
  f.assignedTo,
  f.assignedToId,
  f.isResolved,
  f.createdAt,
  t.tokenNumber,
  o.name as outlet_name
FROM Feedback f
JOIN Token t ON f.tokenId = t.id
JOIN Outlet o ON t.outletId = o.id
WHERE f.rating <= 3
ORDER BY f.createdAt DESC
LIMIT 10;

-- 3. Check alerts specifically for 3-star ratings
SELECT 
  a.id,
  a.type,
  a.severity,
  a.message,
  a.isRead,
  a.createdAt,
  t.tokenNumber,
  f.rating
FROM Alert a
JOIN Token t ON a.relatedEntity = t.id
JOIN Feedback f ON f.tokenId = t.id
WHERE f.rating = 3
ORDER BY a.createdAt DESC
LIMIT 10;

-- 4. Check teleshop managers and their outlets to understand the relationships
SELECT 
  tm.id as teleshop_manager_id,
  tm.name as teleshop_manager_name,
  COUNT(o.id) as officer_count,
  STRING_AGG(DISTINCT out.name, ', ') as outlet_names
FROM TeleshopManager tm
LEFT JOIN Officer o ON o.teleshopManagerId = tm.id
LEFT JOIN Outlet out ON o.outletId = out.id
GROUP BY tm.id, tm.name
ORDER BY officer_count DESC;