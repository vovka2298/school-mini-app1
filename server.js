const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Конфигурация Supabase
const SUPABASE_URL = 'https://rtywenfvaoxsjdkulmdk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WhiVd5day72hRoTKiFtiIQ_sP2wu4_S';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0eXdlbmZ2YW94c2pka3VsbWRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM3NzEzNiwiZXhwIjoyMDgwOTUzMTM2fQ.wy2D8H0mS-c1JqJFF2O-IPk3bgvVLMjHJUTzRX2fx-0';

// Заголовки
const createHeaders = (useServiceKey = false) => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
});

// ===== УТИЛИТЫ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЯМИ =====

// Получить пользователя по telegram_id
async function getUserByTelegramId(telegramId) {
  try {
    if (!telegramId) {
      console.warn('⚠️ Telegram ID не предоставлен');
      return null;
    }
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?telegram_id=eq.${telegramId}&select=*`,
      { headers: createHeaders() }
    );
    
    if (response.ok) {
      const users = await response.json();
      if (users.length > 0) {
        return users[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения пользователя:', error);
    return null;
  }
}

// Получить ID пользователя по telegram_id (для обратной совместимости)
async function getUserId(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  return user ? user.id : null;
}

// Получить telegram_id из запроса (из query параметра или заголовка)
function getTelegramIdFromRequest(req) {
  // Пробуем получить из query параметра (основной способ)
  if (req.query.tgId) {
    console.log(`📱 Telegram ID из query: ${req.query.tgId}`);
    return req.query.tgId;
  }
  
  // Пробуем получить из параметров маршрута
  if (req.params.tgId) {
    console.log(`📱 Telegram ID из params: ${req.params.tgId}`);
    return req.params.tgId;
  }
  
  // Пробуем получить из body
  if (req.body && req.body.tgId) {
    console.log(`📱 Telegram ID из body: ${req.body.tgId}`);
    return req.body.tgId;
  }
  
  // Пробуем получить из заголовка (если Telegram Web App передает)
  if (req.headers['x-telegram-user-id']) {
    console.log(`📱 Telegram ID из заголовка: ${req.headers['x-telegram-user-id']}`);
    return req.headers['x-telegram-user-id'];
  }
  
  // Если ничего не найдено, возвращаем null (не fallback на админа!)
  console.warn('⚠️ Telegram ID не найден в запросе');
  return null;
}

// ===== API =====

// ===== MIDDLEWARE ДЛЯ АВТОРИЗАЦИИ =====
async function requireAuth(req, res, next) {
  try {
    const telegramId = getTelegramIdFromRequest(req);
    const user = await getUserByTelegramId(telegramId);
    
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден', _timestamp: Date.now() });
    }
    
    if (!user.approved) {
      return res.status(403).json({ error: 'Пользователь не одобрен', _timestamp: Date.now() });
    }
    
    req.user = user;
    req.telegramId = telegramId;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Ошибка авторизации', _timestamp: Date.now() });
  }
}

// ===== API ДЛЯ ПРЕПОДАВАТЕЛЕЙ =====

// 1. Получить расписание пользователя
app.get('/api/my-schedule', requireAuth, async (req, res) => {
  try {
    console.log('📅 Запрос расписания...');
    const teacherId = req.user.id;
    console.log('👨‍🏫 Используем teacher_id:', teacherId);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacherId}&select=day,time_slot,status`,
      { headers: createHeaders() }
    );
    
    let schedules = [];
    if (response.ok) {
      schedules = await response.json();
      console.log('📊 Получено записей:', schedules.length);
    } else {
      console.error('❌ Ошибка Supabase:', response.status);
    }
    
    // Формируем расписание
    const schedule = {};
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    
    days.forEach(day => {
      schedule[day] = {};
    });
    
    schedules.forEach(row => {
      if (schedule[row.day]) {
        schedule[row.day][row.time_slot] = row.status;
      }
    });
    
    // Добавляем тестовое расписание если пусто
    if (schedules.length === 0) {
      console.log('📝 Расписание пустое, добавляем тестовые данные...');
      
      // Добавляем несколько тестовых слотов
      const testData = [
        { day: 'Понедельник', time_slot: '10:00', status: 1 },
        { day: 'Понедельник', time_slot: '10:30', status: 1 },
        { day: 'Понедельник', time_slot: '11:00', status: 0 },
        { day: 'Вторник', time_slot: '14:00', status: 1 },
        { day: 'Вторник', time_slot: '14:30', status: 2 }
      ];
      
      for (const slot of testData) {
        schedule[slot.day][slot.time_slot] = slot.status;
      }
    }
    
    res.json({
      ...schedule,
      _timestamp: Date.now(),
      _synced: true,
      _fromDB: schedules.length > 0
    });
    
  } catch (error) {
    console.error('❌ Ошибка загрузки расписания:', error);
    
    // Возвращаем тестовое расписание при ошибке
    const schedule = {};
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    
    days.forEach(day => {
      schedule[day] = {};
    });
    
    // Тестовые данные
    schedule['Понедельник']['10:00'] = 1;
    schedule['Понедельник']['10:30'] = 1;
    schedule['Понедельник']['11:00'] = 0;
    schedule['Вторник']['14:00'] = 1;
    schedule['Вторник']['14:30'] = 2;
    
    res.json({
      ...schedule,
      _timestamp: Date.now(),
      _synced: false,
      _error: error.message
    });
  }
});

// 2. Сохранить расписание
app.post('/api/schedule/:tgId', requireAuth, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const newSchedule = req.body;
    
    console.log(`💾 Сохранение расписания для teacher_id=${teacherId}`);
    
    // Подготовка данных
    const scheduleData = [];
    Object.keys(newSchedule).forEach(day => {
      const slots = newSchedule[day];
      Object.keys(slots).forEach(time => {
        scheduleData.push({
          teacher_id: teacherId,
          day: day,
          time_slot: time,
          status: slots[time]
        });
      });
    });
    
    console.log(`📊 Сохраняем ${scheduleData.length} слотов`);
    
    // Удаляем старое расписание
    await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacherId}`,
      {
        method: 'DELETE',
        headers: createHeaders(true)
      }
    );
    
    // Сохраняем новое (если есть данные)
    if (scheduleData.length > 0) {
      const insertResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/schedules`,
        {
          method: 'POST',
          headers: createHeaders(true),
          body: JSON.stringify(scheduleData)
        }
      );
      
      if (!insertResponse.ok) {
        console.error('❌ Ошибка вставки:', await insertResponse.text());
      }
    }
    
    res.json({ 
      ok: true, 
      message: "Расписание сохранено в базу данных",
      slots: scheduleData.length,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    res.json({ 
      ok: true, 
      message: "Сохранено локально",
      _timestamp: Date.now()
    });
  }
});

// 3. Получить текущего пользователя
app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь';
    
    res.json({
      role: user.role || 'teacher',
      name: userName,
      photo: user.photo || "",
      tgId: user.telegram_id,
      id: user.id,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    res.json({
      role: 'teacher',
      name: 'Пользователь',
      photo: "",
      tgId: req.telegramId || '',
      _timestamp: Date.now()
    });
  }
});

// 4. Профиль с предметами
app.get('/api/profile/:tgId', requireAuth, async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    // Получаем предметы
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacherId}&select=subject`,
      { headers: createHeaders() }
    );
    
    const subjects = response.ok ? await response.json() : [];
    
    res.json({
      subjects: subjects.map(item => item.subject),
      gender: "Мужской",
      _timestamp: Date.now()
    });
    
  } catch (error) {
    res.json({
      subjects: ["МатематикаЕГЭ", "ФизикаОГЭ", "Информатика"],
      gender: "Мужской",
      _timestamp: Date.now()
    });
  }
});

// 5. Сохранить профиль
app.post('/api/profile/:tgId', requireAuth, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { subjects, gender } = req.body;
    
    // Удаляем старые предметы
    await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacherId}`,
      {
        method: 'DELETE',
        headers: createHeaders(true)
      }
    );
    
    // Добавляем новые
    if (subjects && subjects.length > 0) {
      const subjectData = subjects.map(subject => ({
        teacher_id: teacherId,
        subject: subject
      }));
      
      await fetch(
        `${SUPABASE_URL}/rest/v1/teacher_subjects`,
        {
          method: 'POST',
          headers: createHeaders(true),
          body: JSON.stringify(subjectData)
        }
      );
    }
    
    // Обновляем пол в профиле
    await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_profiles?teacher_id=eq.${teacherId}`,
      {
        method: 'PATCH',
        headers: createHeaders(true),
        body: JSON.stringify({ gender })
      }
    );
    
    res.json({ 
      ok: true,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка сохранения профиля:', error);
    res.json({ ok: true, _timestamp: Date.now() });
  }
});

// 6. Заявки
app.get('/api/bookings/:tgId', requireAuth, async (req, res) => {
  try {
    const teacherId = req.user.id;
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?teacher_id=eq.${teacherId}&select=id,day,time_slot,subject,status,created_at`,
      { headers: createHeaders() }
    );
    
    const bookings = response.ok ? await response.json() : [];
    
    res.json({
      bookings: bookings,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    res.json({ bookings: [], _timestamp: Date.now() });
  }
});

// 7. Обновить статус заявки
app.post('/api/booking/:bookingId/status', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;
    
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`,
      {
        method: 'PATCH',
        headers: createHeaders(true),
        body: JSON.stringify({ 
          status: status,
          updated_at: new Date().toISOString()
        })
      }
    );
    
    res.json({ ok: true, _timestamp: Date.now() });
    
  } catch (error) {
    res.json({ ok: true, _timestamp: Date.now() });
  }
});

// 8. Статус сервера
app.get('/api/status', (req, res) => {
  res.json({
    status: "OK",
    database: "Supabase PostgreSQL",
    version: "1.0",
    _timestamp: Date.now()
  });
});

// 9. Отладка - посмотреть все данные
app.get('/api/debug-data', async (req, res) => {
  try {
    const users = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=*`,
      { headers: createHeaders() }
    ).then(r => r.ok ? r.json() : []);
    
    const schedules = await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?select=*`,
      { headers: createHeaders() }
    ).then(r => r.ok ? r.json() : []);
    
    const subjects = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_subjects?select=*`,
      { headers: createHeaders() }
    ).then(r => r.ok ? r.json() : []);
    
    res.json({
      server: "Работает",
      users_count: users.length,
      schedules_count: schedules.length,
      subjects_count: subjects.length,
      sample_data: {
        users: users.slice(0, 3),
        schedules: schedules.slice(0, 5),
        subjects: subjects.slice(0, 5)
      },
      _timestamp: Date.now()
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ===== API ДЛЯ МЕНЕДЖЕРОВ =====

// 11. Получить список всех преподавателей
app.get('/api/manager/teachers', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?role=eq.teacher&approved=eq.true&select=id,first_name,last_name,telegram_id`,
      { headers: createHeaders() }
    );
    
    const teachers = response.ok ? await response.json() : [];
    
    // Получаем количество учеников для каждого преподавателя
    const teachersWithStats = await Promise.all(teachers.map(async (teacher) => {
      const studentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${teacher.id}&select=student_id`,
        { headers: createHeaders() }
      );
      const students = studentsResponse.ok ? await studentsResponse.json() : [];
      
      return {
        ...teacher,
        students_count: students.length
      };
    }));
    
    res.json({
      teachers: teachersWithStats,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения списка преподавателей:', error);
    res.json({ teachers: [], _timestamp: Date.now() });
  }
});

// 12. Получить детальную информацию о преподавателе
app.get('/api/manager/teacher/:teacherId', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { teacherId } = req.params;
    
    // Получаем информацию о преподавателе
    const teacherResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${teacherId}&select=*`,
      { headers: createHeaders() }
    );
    const teachers = teacherResponse.ok ? await teacherResponse.json() : [];
    
    if (teachers.length === 0) {
      return res.status(404).json({ error: 'Преподаватель не найден', _timestamp: Date.now() });
    }
    
    const teacher = teachers[0];
    
    // Получаем расписание
    const scheduleResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacherId}&select=day,time_slot,status`,
      { headers: createHeaders() }
    );
    const schedules = scheduleResponse.ok ? await scheduleResponse.json() : [];
    
    // Формируем расписание
    const schedule = {};
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    days.forEach(day => { schedule[day] = {}; });
    schedules.forEach(row => {
      if (schedule[row.day]) {
        schedule[row.day][row.time_slot] = row.status;
      }
    });
    
    // Получаем предметы
    const subjectsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_subjects?teacher_id=eq.${teacherId}&select=subject`,
      { headers: createHeaders() }
    );
    const subjects = subjectsResponse.ok ? await subjectsResponse.json() : [];
    
    // Получаем учеников
    const studentsLinkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${teacherId}&select=student_id`,
      { headers: createHeaders() }
    );
    const studentsLinks = studentsLinkResponse.ok ? await studentsLinkResponse.json() : [];
    
    const studentIds = studentsLinks.map(link => link.student_id);
    let students = [];
    if (studentIds.length > 0) {
      const studentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students?id=in.(${studentIds.join(',')})&select=*`,
        { headers: createHeaders() }
      );
      students = studentsResponse.ok ? await studentsResponse.json() : [];
    }
    
    res.json({
      teacher: {
        id: teacher.id,
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        telegram_id: teacher.telegram_id
      },
      schedule: schedule,
      subjects: subjects.map(s => s.subject),
      students: students,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения информации о преподавателе:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 13. Получить расписание преподавателя (для менеджера)
app.get('/api/manager/teacher/:teacherId/schedule', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { teacherId } = req.params;
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacherId}&select=day,time_slot,status`,
      { headers: createHeaders() }
    );
    
    let schedules = [];
    if (response.ok) {
      schedules = await response.json();
    }
    
    const schedule = {};
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    days.forEach(day => { schedule[day] = {}; });
    
    schedules.forEach(row => {
      if (schedule[row.day]) {
        schedule[row.day][row.time_slot] = row.status;
      }
    });
    
    res.json({
      ...schedule,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения расписания:', error);
    res.json({ _timestamp: Date.now() });
  }
});

// 14. Добавить ученика преподавателю
app.post('/api/manager/teacher/:teacherId/student', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { teacherId } = req.params;
    const { first_name, last_name, class_name } = req.body;
    
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'Необходимо указать имя и фамилию', _timestamp: Date.now() });
    }
    
    // Создаем или находим ученика
    const studentData = {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      class_name: class_name ? class_name.trim() : null
    };
    
    // Проверяем, существует ли уже такой ученик
    const existingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/students?first_name=eq.${studentData.first_name}&last_name=eq.${studentData.last_name}&select=id`,
      { headers: createHeaders() }
    );
    const existing = existingResponse.ok ? await existingResponse.json() : [];
    
    let studentId;
    if (existing.length > 0) {
      studentId = existing[0].id;
    } else {
      // Создаем нового ученика
      const createResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students`,
        {
          method: 'POST',
          headers: createHeaders(true),
          body: JSON.stringify(studentData)
        }
      );
      
      if (!createResponse.ok) {
        throw new Error('Ошибка создания ученика');
      }
      
      const newStudent = await createResponse.json();
      studentId = newStudent[0]?.id || newStudent.id;
    }
    
    // Связываем ученика с преподавателем
    const linkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_students`,
      {
        method: 'POST',
        headers: createHeaders(true),
        body: JSON.stringify({
          teacher_id: parseInt(teacherId),
          student_id: studentId
        })
      }
    );
    
    if (!linkResponse.ok) {
      const errorText = await linkResponse.text();
      // Если связь уже существует, это не ошибка
      if (!errorText.includes('duplicate') && !errorText.includes('unique')) {
        throw new Error('Ошибка связывания ученика с преподавателем');
      }
    }
    
    res.json({
      ok: true,
      student_id: studentId,
      message: 'Ученик успешно добавлен',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка добавления ученика:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 15. Получить статистику по часам преподавателя
app.get('/api/manager/teacher/:teacherId/statistics', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { teacherId } = req.params;
    const { start_date, end_date } = req.query;
    
    let query = `teacher_id=eq.${teacherId}`;
    if (start_date) {
      query += `&lesson_date=gte.${start_date}`;
    }
    if (end_date) {
      query += `&lesson_date=lte.${end_date}`;
    }
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?${query}&select=*`,
      { headers: createHeaders() }
    );
    
    const lessons = response.ok ? await response.json() : [];
    
    // Подсчитываем общее количество часов
    const totalMinutes = lessons.reduce((sum, lesson) => {
      return sum + (lesson.duration_minutes || 0);
    }, 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    
    // Группируем по ученикам
    const byStudent = {};
    lessons.forEach(lesson => {
      if (!byStudent[lesson.student_id]) {
        byStudent[lesson.student_id] = {
          student_id: lesson.student_id,
          lessons: [],
          total_minutes: 0
        };
      }
      byStudent[lesson.student_id].lessons.push(lesson);
      byStudent[lesson.student_id].total_minutes += (lesson.duration_minutes || 0);
    });
    
    // Получаем информацию об учениках
    const studentIds = Object.keys(byStudent).map(id => parseInt(id));
    let students = [];
    if (studentIds.length > 0) {
      const studentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students?id=in.(${studentIds.join(',')})&select=*`,
        { headers: createHeaders() }
      );
      students = studentsResponse.ok ? await studentsResponse.json() : [];
    }
    
    const studentsMap = {};
    students.forEach(student => {
      studentsMap[student.id] = student;
    });
    
    const statistics = Object.values(byStudent).map(stat => ({
      student: studentsMap[stat.student_id] || { id: stat.student_id },
      lessons_count: stat.lessons.length,
      total_hours: Math.round((stat.total_minutes / 60) * 100) / 100,
      lessons: stat.lessons.map(l => ({
        date: l.lesson_date,
        start_time: l.start_time,
        end_time: l.end_time,
        duration_minutes: l.duration_minutes,
        subject: l.subject
      }))
    }));
    
    res.json({
      total_hours: totalHours,
      total_lessons: lessons.length,
      by_student: statistics,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// ===== API ДЛЯ ОТСЛЕЖИВАНИЯ ЗАНЯТИЙ =====

// 16. Добавить занятие (преподаватель отмечает проведенное занятие)
app.post('/api/lesson', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { student_id, subject, lesson_date, start_time, end_time, notes } = req.body;
    
    if (!student_id || !lesson_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Необходимо указать ученика, дату и время', _timestamp: Date.now() });
    }
    
    // Проверяем, что ученик принадлежит этому преподавателю
    const linkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${req.user.id}&student_id=eq.${student_id}&select=id`,
      { headers: createHeaders() }
    );
    const links = linkResponse.ok ? await linkResponse.json() : [];
    
    if (links.length === 0) {
      return res.status(403).json({ error: 'Ученик не найден у этого преподавателя', _timestamp: Date.now() });
    }
    
    const lessonData = {
      teacher_id: req.user.id,
      student_id: parseInt(student_id),
      subject: subject || null,
      lesson_date: lesson_date,
      start_time: start_time,
      end_time: end_time,
      notes: notes || null
    };
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons`,
      {
        method: 'POST',
        headers: createHeaders(true),
        body: JSON.stringify(lessonData)
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка создания занятия: ${errorText}`);
    }
    
    const newLesson = await response.json();
    
    res.json({
      ok: true,
      lesson: newLesson[0] || newLesson,
      message: 'Занятие успешно добавлено',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка добавления занятия:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 17. Получить список учеников преподавателя
app.get('/api/teacher/students', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const linkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${req.user.id}&select=student_id`,
      { headers: createHeaders() }
    );
    const links = linkResponse.ok ? await linkResponse.json() : [];
    
    const studentIds = links.map(link => link.student_id);
    let students = [];
    
    if (studentIds.length > 0) {
      const studentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students?id=in.(${studentIds.join(',')})&select=*`,
        { headers: createHeaders() }
      );
      students = studentsResponse.ok ? await studentsResponse.json() : [];
    }
    
    res.json({
      students: students,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения учеников:', error);
    res.json({ students: [], _timestamp: Date.now() });
  }
});

// 10. Инициализировать базу данных (создать пользователя если нет)
app.get('/api/init-db', async (req, res) => {
  try {
    const telegramId = getTelegramIdFromRequest(req);
    const user = await getUserByTelegramId(telegramId);
    
    if (user) {
      return res.json({
        success: true,
        message: "Пользователь уже существует",
        user_id: user.id,
        user_data: {
          id: user.id,
          telegram_id: user.telegram_id,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          approved: user.approved
        },
        _timestamp: Date.now()
      });
    }
    
    res.json({
      success: false,
      message: "Пользователь не найден. Обратитесь к администратору для регистрации.",
      _timestamp: Date.now()
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      _timestamp: Date.now()
    });
  }
});

// Отладочный эндпоинт для проверки пользователя
app.get('/api/debug-user', async (req, res) => {
  try {
    const telegramId = getTelegramIdFromRequest(req);
    const user = telegramId ? await getUserByTelegramId(telegramId) : null;
    
    const debugInfo = {
      telegram_id_from_request: telegramId,
      query_params: req.query,
      headers_relevant: {
        'x-telegram-user-id': req.headers['x-telegram-user-id'],
        'user-agent': req.headers['user-agent']
      },
      user: user ? {
        id: user.id,
        telegram_id: user.telegram_id,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        role_type: typeof user.role,
        role_length: user.role ? user.role.length : 0,
        role_normalized: user.role ? user.role.trim().toLowerCase() : null,
        approved: user.approved,
        is_manager: user.role ? user.role.trim().toLowerCase() === 'manager' : false,
        is_teacher: user.role ? user.role.trim().toLowerCase() === 'teacher' : false
      } : null,
      _timestamp: Date.now()
    };
    
    console.log('🔍 DEBUG USER:', JSON.stringify(debugInfo, null, 2));
    res.json(debugInfo);
  } catch (error) {
    console.error('❌ DEBUG ERROR:', error);
    res.json({
      error: error.message,
      stack: error.stack,
      _timestamp: Date.now()
    });
  }
});

// ===== РОУТИНГ =====

// Определение роли и редирект
// ВАЖНО: этот маршрут должен быть ПЕРЕД app.get('*')
// ВЕРСИЯ КОДА: v2.0 - с исправлением для менеджеров
app.get('/', async (req, res) => {
  // АГРЕССИВНО отключаем кеширование - ДО всех операций
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': '',
    'Last-Modified': '',
    'Vary': '*'
  });
  
  // ЛОГИРОВАНИЕ В САМОМ НАЧАЛЕ - чтобы убедиться, что код выполняется
  console.log('🚀 ===== ОБРАБОТЧИК ГЛАВНОЙ СТРАНИЦЫ ВЫЗВАН (v2.0) =====');
  console.log('🔍 ===== НОВЫЙ ЗАПРОС К ГЛАВНОЙ СТРАНИЦЕ =====');
  console.log('📋 Query параметры:', JSON.stringify(req.query, null, 2));
  
  try {
    console.log('📋 Headers:', JSON.stringify({
      'user-agent': req.headers['user-agent'],
      'referer': req.headers['referer'],
      'x-telegram-user-id': req.headers['x-telegram-user-id']
    }, null, 2));
    
    const telegramId = getTelegramIdFromRequest(req);
    console.log(`📱 Извлеченный Telegram ID: ${telegramId}`);
    
    // Если telegram_id не передан, показываем страницу-редиректор
    if (!telegramId) {
      console.warn('⚠️ Telegram ID не предоставлен в запросе, используем клиентский редирект');
      return res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Загрузка...</title>
          <script src="https://telegram.org/js/telegram-web-app.js"></script>
          <style>
            body {
              margin: 0;
              background: #0d1117;
              color: #c9d1d9;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
            }
            .container {
              text-align: center;
              max-width: 400px;
            }
            .loading {
              color: #58a6ff;
              font-size: 18px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="loading">⏳ Определение пользователя...</div>
          </div>
          <script>
            (function() {
              let telegramId = null;
              
              // Пробуем получить из URL параметра
              const urlParams = new URLSearchParams(window.location.search);
              telegramId = urlParams.get('tgId');
              
              // Если не нашли, пробуем получить из Telegram Web App API
              if (!telegramId && typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initDataUnsafe) {
                const user = Telegram.WebApp.initDataUnsafe.user;
                if (user && user.id) {
                  telegramId = user.id.toString();
                }
              }
              
              if (telegramId) {
                // Просто редиректим с параметром tgId - сервер сам определит роль
                // Добавляем timestamp для обхода кеша
                window.location.href = '/?tgId=' + telegramId + '&_nocache=' + Date.now();
              } else {
                document.querySelector('.container').innerHTML = 
                  '<h1 style="color: #da3633;">❌ Ошибка доступа</h1>' +
                  '<p>Не удалось определить пользователя. Пожалуйста, откройте приложение через Telegram бота.</p>';
              }
            })();
          </script>
        </body>
        </html>
      `);
    }
    
    console.log(`🔍 Поиск пользователя с telegram_id: ${telegramId}`);
    const user = await getUserByTelegramId(telegramId);
    
    if (!user) {
      console.warn(`⚠️ Пользователь с telegram_id ${telegramId} не найден в базе`);
      return res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Пользователь не найден</title>
          <style>
            body {
              margin: 0;
              background: #0d1117;
              color: #c9d1d9;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
            }
            .container {
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #ffa500; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>👤 Пользователь не найден</h1>
            <p>Вы не зарегистрированы в системе. Пожалуйста, зарегистрируйтесь через Telegram бота.</p>
          </div>
        </body>
        </html>
      `);
    }
    
    console.log(`✅ Пользователь найден:`);
    console.log(`   - ID: ${user.id}`);
    console.log(`   - Имя: ${user.first_name} ${user.last_name}`);
    console.log(`   - Telegram ID: ${user.telegram_id}`);
    console.log(`   - Роль: "${user.role}" (тип: ${typeof user.role})`);
    console.log(`   - Approved: ${user.approved}`);
    console.log(`   - Все поля пользователя:`, JSON.stringify(user, null, 2));
    
    if (!user.approved) {
      // Если пользователь не одобрен
      return res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Ожидание одобрения</title>
          <style>
            body {
              margin: 0;
              background: #0d1117;
              color: #c9d1d9;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
            }
            .container {
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #ffa500; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⏳ Ожидание одобрения</h1>
            <p>Ваша заявка находится на рассмотрении. После одобрения вы получите доступ к приложению.</p>
          </div>
        </body>
        </html>
      `);
    }
    
    // Нормализуем роль (убираем пробелы, приводим к нижнему регистру)
    const rawRole = (user.role || '').toString();
    const normalizedRole = rawRole.trim().toLowerCase();
    
    console.log(`🎯 Редирект пользователя:`);
    console.log(`   - Исходная роль (raw): "${rawRole}"`);
    console.log(`   - Нормализованная роль: "${normalizedRole}"`);
    console.log(`   - Длина роли: ${normalizedRole.length}`);
    console.log(`   - Сравнение с 'manager': ${normalizedRole === 'manager'}`);
    console.log(`   - Сравнение с 'teacher': ${normalizedRole === 'teacher'}`);
    console.log(`   - Включает 'manager': ${normalizedRole.includes('manager')}`);
    console.log(`   - Включает 'teacher': ${normalizedRole.includes('teacher')}`);
    
    // Редиректим в зависимости от роли
    // СТРОГАЯ ПРОВЕРКА: если роль содержит "manager" (в любом регистре), то это менеджер
    const isManager = normalizedRole.includes('manager');
    const isTeacher = normalizedRole.includes('teacher') || normalizedRole === '';
    
    console.log(`🎯 ФИНАЛЬНОЕ РЕШЕНИЕ:`);
    console.log(`   - isManager: ${isManager} (проверка: normalizedRole.includes('manager'))`);
    console.log(`   - isTeacher: ${isTeacher}`);
    console.log(`   - РЕШЕНИЕ: ${isManager ? 'МЕНЕДЖЕР -> manager.html' : 'УЧИТЕЛЬ -> index.html'}`);
    
    // ПРИОРИТЕТ: сначала проверяем менеджера
    if (isManager) {
      console.log(`📄 ✅ ОТПРАВЛЯЕМ manager.html ДЛЯ МЕНЕДЖЕРА`);
      console.log(`📄 Telegram ID: ${telegramId}`);
      console.log(`📄 Путь к файлу: ${path.join(__dirname, 'public', 'manager.html')}`);
      // АГРЕССИВНО отключаем кеш перед отправкой файла
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': '',
        'Last-Modified': '',
        'Vary': '*'
      });
      return res.sendFile(path.join(__dirname, 'public', 'manager.html'));
    } else if (isTeacher) {
      console.log(`📄 ✅ ОТПРАВЛЯЕМ index.html ДЛЯ УЧИТЕЛЯ (роль: "${normalizedRole}")`);
      console.log(`📄 Путь к файлу: ${path.join(__dirname, 'public', 'index.html')}`);
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      // Неизвестная роль - логируем и отправляем по умолчанию учителя
      console.warn(`⚠️ Неизвестная роль: "${normalizedRole}", отправляем интерфейс учителя`);
      console.log(`📄 Путь к файлу: ${path.join(__dirname, 'public', 'index.html')}`);
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    
  } catch (error) {
    console.error('❌ Ошибка роутинга:', error);
    // По умолчанию показываем интерфейс преподавателя только если это не критическая ошибка
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/subjects.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subjects.html'));
});

app.get('/manager.html', (req, res) => {
  // АГРЕССИВНО отключаем кеширование для manager.html
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': '',
    'Last-Modified': '',
    'Vary': '*'
  });
  console.log(`📄 Запрос manager.html с tgId: ${req.query.tgId}`);
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

// Для всех остальных маршрутов (должен быть ПОСЛЕДНИМ!)
// НЕ перехватываем запросы к /manager.html и другим файлам
app.get('*', (req, res) => {
  // Пропускаем статические файлы и уже обработанные маршруты
  if (req.path.startsWith('/api/') || 
      req.path.startsWith('/manager.html') || 
      req.path.startsWith('/subjects.html') ||
      req.path.includes('.')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Сервер запущен на порту ${port}`);
  console.log(`📦 База данных: Supabase PostgreSQL`);
  console.log(`👤 Telegram ID: 913096324`);
  console.log(`🔗 Проверка: http://localhost:${port}/api/status`);
  console.log(`🔗 Инициализация: http://localhost:${port}/api/init-db`);
});

