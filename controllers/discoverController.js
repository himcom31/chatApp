const pool = require('../config/db');

const GENDERS = ['male', 'female', 'other'];

// chat_requests table columns (per schema)
const REQ_TABLE = 'chat_requests';
const REQ_SENDER = 'sender_id';
const REQ_RECEIVER = 'receiver_id';
const REQ_STATUS = 'status';

const toAbsoluteUrl = (req, path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${req.protocol}://${req.get('host')}${clean}`;
};

const parseInterests = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getAge = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

// GET /api/discover?city=&gender=&minAge=&maxAge=&interests=cricket,music&q=&page=1&limit=20
async function discoverUsers(req, res) {
  const me = Number(req.user.userId);
  const { gender, minAge, maxAge, interests, q } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = (page - 1) * limit;

  try {
    // City: if not provided in the query, use the first part of the user's own location (e.g. "Noida, UP" -> "Noida")
    let city = req.query.city;
    if (city === undefined) {
      const [[mine]] = await pool.query('SELECT location FROM users WHERE id = ?', [me]);
      city = mine?.location ? mine.location.split(',')[0].trim() : '';
    }
    city = String(city).trim();

    const where = ['u.id != ?'];
    const whereParams = [me];

    if (city) {
      where.push('u.location LIKE ?');
      whereParams.push(`${city}%`);
    }

    if (GENDERS.includes(gender)) {
      where.push('u.gender = ?');
      whereParams.push(gender);
    }

    const min = parseInt(minAge, 10);
    if (!isNaN(min)) {
      where.push('u.dob <= DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
      whereParams.push(min);
    }

    const max = parseInt(maxAge, 10);
    if (!isNaN(max)) {
      where.push('u.dob >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
      whereParams.push(max + 1);
    }

    // Interests: show users matching any one of them (OR)
    const interestList = String(interests || '')
      .split(',')
      .map((i) => i.trim().toLowerCase().replace(/"/g, ''))
      .filter(Boolean)
      .slice(0, 10);
    if (interestList.length) {
      const parts = interestList.map(() => 'LOWER(u.interests) LIKE ?');
      where.push(`(${parts.join(' OR ')})`);
      interestList.forEach((i) => whereParams.push(`%"${i}"%`));
    }

    const search = String(q || '').trim();
    if (search) {
      where.push('(u.bio LIKE ? OR u.full_name LIKE ? OR u.username LIKE ?)');
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Pick each user's most relevant request as a single row:
    // accepted > pending > others, then latest. Output: "status|sender_id"
    const reqSubquery = `(
      SELECT CONCAT(r.${REQ_STATUS}, '|', r.${REQ_SENDER})
      FROM ${REQ_TABLE} r
      WHERE (r.${REQ_SENDER} = ? AND r.${REQ_RECEIVER} = u.id)
         OR (r.${REQ_SENDER} = u.id AND r.${REQ_RECEIVER} = ?)
      ORDER BY (r.${REQ_STATUS} = 'accepted') DESC,
               (r.${REQ_STATUS} = 'pending') DESC,
               r.id DESC
      LIMIT 1
    )`;

    const sql = `
      SELECT u.id, u.username, u.full_name, u.gender, u.dob, u.location,
             u.bio, u.about, u.interests, u.avatar_url, u.profile_photo,
             ${reqSubquery} AS req
      FROM users u
      WHERE ${where.join(' AND ')}
      ORDER BY (u.location LIKE ?) DESC, u.last_seen DESC
      LIMIT ? OFFSET ?`;

    const params = [
      me, me,            // subquery placeholders (they appear first in the SELECT)
      ...whereParams,
      `${city}%`,
      limit,
      offset,
    ];

    const [rows] = await pool.query(sql, params);

    const users = rows.map((u) => {
      let requestStatus = null;
      const [status, senderRaw] = (u.req || '').split('|');
      const sender = Number(senderRaw);

      if (status === 'accepted') requestStatus = 'accepted';
      else if (status === 'pending') {
        requestStatus = sender === me ? 'pending' : 'incoming';
      }
      // 'rejected' or no row: requestStatus stays null, so "Send Request" is shown

      return {
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        gender: u.gender || null,
        age: getAge(u.dob),
        location: u.location || null,
        bio: u.bio || u.about || null,
        interests: parseInterests(u.interests),
        avatar_url: u.avatar_url || toAbsoluteUrl(req, u.profile_photo),
        requestStatus,
      };
    });

    res.json({ users, city, page, hasMore: rows.length === limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

module.exports = { discoverUsers };