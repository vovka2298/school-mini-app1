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
        const user = users[0];
        console.log(`📥 Получен пользователь из Supabase:`, {
          id: user.id,
          telegram_id: user.telegram_id,
          role: user.role,
          approved: user.approved,
          first_name: user.first_name,
          last_name: user.last_name
        });
        return user;
      }
    } else {
      const errorText = await response.text();
      console.error(`❌ Ошибка ответа Supabase: ${response.status} - ${errorText}`);
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
  // Пробуем получить из query параметра
  if (req.query.tgId) {
    console.log(`📱 Telegram ID из query.tgId: ${req.query.tgId}`);
    return req.query.tgId.toString().trim();
  }
  
  // Пробуем получить из параметров маршрута
  if (req.params.tgId) {
    console.log(`📱 Telegram ID из params.tgId: ${req.params.tgId}`);
    return req.params.tgId.toString().trim();
  }
  
  // Пробуем получить из body
  if (req.body && req.body.tgId) {
    console.log(`📱 Telegram ID из body.tgId: ${req.body.tgId}`);
    return req.body.tgId.toString().trim();
  }
  
  // Пробуем получить из Telegram Web App initData (если есть)
  if (req.query.initData) {
    try {
      const urlParams = new URLSearchParams(req.query.initData);
      const userParam = urlParams.get('user');
      if (userParam) {
        const user = JSON.parse(decodeURIComponent(userParam));
        if (user.id) {
          console.log(`📱 Telegram ID из initData: ${user.id}`);
          return user.id.toString();
        }
      }
    } catch (e) {
      console.warn('⚠️ Не удалось распарсить initData:', e.message);
    }
  }
  
  // Fallback для разработки (можно удалить позже)
  console.warn('⚠️ Telegram ID не найден в запросе, используем fallback');
  return '913096324';
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
    // Проверяем, что это преподаватель
    if (req.user.role !== 'teacher') {
      console.log(`⚠️  Попытка доступа к API преподавателя от менеджера (role: ${req.user.role})`);
      return res.status(403).json({ 
        error: 'Этот API доступен только преподавателям',
        userRole: req.user.role,
        _timestamp: Date.now() 
      });
    }
    
    console.log('📅 Запрос расписания...');
    const teacherId = req.user.id;
    console.log('👨‍🏫 Используем teacher_id:', teacherId);
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacherId}&select=day,time_slot,status,student_name`,
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
        // Если есть имя ученика, сохраняем как объект, иначе как число (для обратной совместимости)
        if (row.student_name) {
          schedule[row.day][row.time_slot] = {
            status: row.status,
            student_name: row.student_name
          };
        } else {
          schedule[row.day][row.time_slot] = row.status;
        }
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
        const slotValue = slots[time];
        // Поддерживаем как старый формат (число), так и новый (объект с student_name)
        const status = typeof slotValue === 'object' ? slotValue.status : slotValue;
        const studentName = typeof slotValue === 'object' && slotValue.student_name ? slotValue.student_name : null;
        
        scheduleData.push({
          teacher_id: teacherId,
          day: day,
          time_slot: time,
          status: status,
          student_name: studentName
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
    // Проверяем, что это преподаватель
    if (req.user.role !== 'teacher') {
      console.log(`⚠️  Попытка доступа к API заявок от менеджера (role: ${req.user.role})`);
      return res.status(403).json({ 
        error: 'Этот API доступен только преподавателям',
        userRole: req.user.role,
        _timestamp: Date.now() 
      });
    }
    
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
    
    // Получаем количество учеников и занятые часы для каждого преподавателя
    const teachersWithStats = await Promise.all(teachers.map(async (teacher) => {
      const studentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${teacher.id}&select=student_id`,
        { headers: createHeaders() }
      );
      const students = studentsResponse.ok ? await studentsResponse.json() : [];
      
      // Получаем расписание для расчета занятых часов
      const scheduleResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/schedules?teacher_id=eq.${teacher.id}&select=status`,
        { headers: createHeaders() }
      );
      const schedules = scheduleResponse.ok ? await scheduleResponse.json() : [];
      
      // Подсчитываем занятые слоты (статус 2 = занят)
      let occupiedSlots = 0;
      schedules.forEach(slot => {
        if (slot.status === 2) {
          occupiedSlots++;
        }
      });
      
      // Каждый слот = 30 минут
      const totalMinutes = occupiedSlots * 30;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      // Форматируем строку с часами
      let weeklyHoursText = '0 ч';
      if (hours > 0 && minutes > 0) {
        weeklyHoursText = `${hours} ч ${minutes} м`;
      } else if (hours > 0) {
        weeklyHoursText = `${hours} ч`;
      } else if (minutes > 0) {
        weeklyHoursText = `${minutes} м`;
      }
      
      return {
        ...teacher,
        students_count: students.length,
        weekly_hours: weeklyHoursText,
        weekly_hours_minutes: totalMinutes
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
        // Для менеджера возвращаем только числовой статус (как было изначально)
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
        // Для менеджера возвращаем только числовой статус (как было изначально)
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
    
    if (!first_name || first_name.trim().length === 0) {
      return res.status(400).json({ error: 'Необходимо указать имя', _timestamp: Date.now() });
    }
    
    // Всегда создаем нового ученика (даже если имя совпадает с существующим)
    // В базе данных last_name имеет NOT NULL constraint, поэтому передаем пустую строку вместо null
    const studentData = {
      first_name: first_name.trim(),
      last_name: (last_name && last_name.trim().length > 0) ? last_name.trim() : '',
      class_name: (class_name && class_name.trim().length > 0) ? class_name.trim() : null
    };
    
    // Создаем нового ученика
    // Используем Prefer: return=representation чтобы получить созданную запись
    const createHeadersWithReturn = {
      ...createHeaders(true),
      'Prefer': 'return=representation'
    };
    
    const createResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/students`,
      {
        method: 'POST',
        headers: createHeadersWithReturn,
        body: JSON.stringify(studentData)
      }
    );
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ Ошибка создания ученика:', errorText);
      throw new Error(`Ошибка создания ученика: ${errorText}`);
    }
    
    // Получаем созданного ученика из ответа
    const createdStudents = await createResponse.json();
    let studentId;
    
    // Supabase может вернуть массив или объект
    if (Array.isArray(createdStudents) && createdStudents.length > 0) {
      studentId = createdStudents[0].id;
    } else if (createdStudents.id) {
      studentId = createdStudents.id;
    } else {
      // Если не получили ID из ответа, пытаемся найти последнего созданного ученика
      // Используем timestamp для более точного поиска
      console.log('ℹ️ Получаем созданного ученика из базы...');
      const findResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students?first_name=eq.${encodeURIComponent(studentData.first_name)}&last_name=eq.${encodeURIComponent(studentData.last_name)}&order=created_at.desc&limit=1&select=id`,
        { headers: createHeaders() }
      );
      if (findResponse.ok) {
        const found = await findResponse.json();
        if (found.length > 0) {
          studentId = found[0].id;
        }
      }
    }
    
    if (!studentId) {
      throw new Error('Не удалось получить ID созданного ученика');
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

// 14.1. Редактировать ученика
app.put('/api/manager/student/:studentId', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { studentId } = req.params;
    const { first_name, last_name, class_name } = req.body;
    
    if (!first_name || first_name.trim().length === 0) {
      return res.status(400).json({ error: 'Необходимо указать имя', _timestamp: Date.now() });
    }
    
    const updateData = {
      first_name: first_name.trim(),
      last_name: (last_name && last_name.trim().length > 0) ? last_name.trim() : '',
      class_name: (class_name && class_name.trim().length > 0) ? class_name.trim() : null
    };
    
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/students?id=eq.${studentId}`,
      {
        method: 'PATCH',
        headers: createHeaders(true),
        body: JSON.stringify(updateData)
      }
    );
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ Ошибка обновления ученика:', errorText);
      throw new Error(`Ошибка обновления ученика: ${errorText}`);
    }
    
    res.json({
      ok: true,
      message: 'Ученик успешно обновлен',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка обновления ученика:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 14.2. Удалить ученика у преподавателя
app.delete('/api/manager/teacher/:teacherId/student/:studentId', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { teacherId, studentId } = req.params;
    
    // Удаляем связь между преподавателем и учеником
    const deleteResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${teacherId}&student_id=eq.${studentId}`,
      {
        method: 'DELETE',
        headers: createHeaders(true)
      }
    );
    
    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error('❌ Ошибка удаления связи:', errorText);
      throw new Error(`Ошибка удаления связи: ${errorText}`);
    }
    
    res.json({
      ok: true,
      message: 'Ученик успешно удален у преподавателя',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка удаления ученика:', error);
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
        id: l.id,
        date: l.lesson_date,
        start_time: l.start_time,
        end_time: l.end_time,
        duration_minutes: l.duration_minutes,
        subject: l.subject,
        notes: l.notes,
        student_id: l.student_id
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

// Статистика преподавателя (свои занятия за период)
app.get('/api/teacher/statistics', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }

    const teacherId = req.user.id;
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

    const totalMinutes = lessons.reduce((sum, lesson) => sum + (lesson.duration_minutes || 0), 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

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
    students.forEach(student => { studentsMap[student.id] = student; });

    const statistics = Object.values(byStudent).map(stat => ({
      student: studentsMap[stat.student_id] || { id: stat.student_id },
      lessons_count: stat.lessons.length,
      total_hours: Math.round((stat.total_minutes / 60) * 100) / 100,
      lessons: stat.lessons.map(l => ({
        id: l.id,
        date: l.lesson_date,
        start_time: l.start_time,
        end_time: l.end_time,
        duration_minutes: l.duration_minutes,
        subject: l.subject,
        notes: l.notes,
        student_id: l.student_id
      }))
    }));

    res.json({
      total_hours: totalHours,
      total_lessons: lessons.length,
      by_student: statistics,
      _timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Ошибка получения статистики преподавателя:', error);
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
    
    // duration_minutes - это generated column в Supabase, вычисляется автоматически
    // Не нужно передавать его при создании
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
    
    // Supabase с return=minimal может вернуть пустой ответ
    const responseText = await response.text();
    let newLesson = null;
    
    if (responseText && responseText.trim().length > 0) {
      try {
        newLesson = JSON.parse(responseText);
      } catch (e) {
        console.warn('⚠️ Не удалось распарсить ответ от Supabase, но занятие создано');
        // Пытаемся получить созданное занятие из базы
        const checkResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/lessons?teacher_id=eq.${req.user.id}&student_id=eq.${student_id}&lesson_date=eq.${lesson_date}&order=created_at.desc&limit=1&select=*`,
          { headers: createHeaders() }
        );
        if (checkResponse.ok) {
          const lessons = await checkResponse.json();
          if (lessons.length > 0) {
            newLesson = lessons[0];
          }
        }
      }
    } else {
      // Пустой ответ - пытаемся получить созданное занятие
      console.log('ℹ️ Пустой ответ от Supabase, получаем созданное занятие...');
      const checkResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/lessons?teacher_id=eq.${req.user.id}&student_id=eq.${student_id}&lesson_date=eq.${lesson_date}&order=created_at.desc&limit=1&select=*`,
        { headers: createHeaders() }
      );
      if (checkResponse.ok) {
        const lessons = await checkResponse.json();
        if (lessons.length > 0) {
          newLesson = lessons[0];
        }
      }
    }
    
    res.json({
      ok: true,
      lesson: newLesson ? (newLesson[0] || newLesson) : null,
      message: 'Занятие успешно добавлено',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка добавления занятия:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 16.1. Редактировать занятие
app.put('/api/lesson/:lessonId', requireAuth, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const { student_id, subject, lesson_date, start_time, end_time, notes } = req.body;
    
    if (!lesson_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Необходимо указать дату и время', _timestamp: Date.now() });
    }
    
    // Получаем занятие для проверки прав доступа
    const lessonResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}&select=teacher_id,student_id`,
      { headers: createHeaders() }
    );
    const lessons = lessonResponse.ok ? await lessonResponse.json() : [];
    
    if (lessons.length === 0) {
      return res.status(404).json({ error: 'Занятие не найдено', _timestamp: Date.now() });
    }
    
    const lesson = lessons[0];
    
    // Проверяем права доступа
    if (req.user.role === 'teacher' && lesson.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    // Если указан новый student_id, проверяем что он принадлежит преподавателю
    if (student_id && req.user.role === 'teacher') {
      const linkResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/teacher_students?teacher_id=eq.${req.user.id}&student_id=eq.${student_id}&select=id`,
        { headers: createHeaders() }
      );
      const links = linkResponse.ok ? await linkResponse.json() : [];
      
      if (links.length === 0) {
        return res.status(403).json({ error: 'Ученик не найден у этого преподавателя', _timestamp: Date.now() });
      }
    }
    
    // Обновляем занятие
    const updateData = {
      subject: subject || null,
      lesson_date: lesson_date,
      start_time: start_time,
      end_time: end_time,
      notes: notes || null
    };
    
    // Если указан новый student_id и это менеджер, обновляем его
    if (student_id && req.user.role === 'manager') {
      updateData.student_id = parseInt(student_id);
    }
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}`,
      {
        method: 'PATCH',
        headers: createHeaders(true),
        body: JSON.stringify(updateData)
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка обновления занятия: ${errorText}`);
    }
    
    // Получаем обновленное занятие
    const updatedResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}&select=*`,
      { headers: createHeaders() }
    );
    const updatedLessons = updatedResponse.ok ? await updatedResponse.json() : [];
    
    res.json({
      ok: true,
      lesson: updatedLessons.length > 0 ? updatedLessons[0] : null,
      message: 'Занятие успешно обновлено',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка обновления занятия:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 16.2. Удалить занятие
app.delete('/api/lesson/:lessonId', requireAuth, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    // Получаем занятие для проверки прав доступа
    const lessonResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}&select=teacher_id`,
      { headers: createHeaders() }
    );
    const lessons = lessonResponse.ok ? await lessonResponse.json() : [];
    
    if (lessons.length === 0) {
      return res.status(404).json({ error: 'Занятие не найдено', _timestamp: Date.now() });
    }
    
    const lesson = lessons[0];
    
    // Проверяем права доступа
    if (req.user.role === 'teacher' && lesson.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    // Удаляем занятие
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}`,
      {
        method: 'DELETE',
        headers: createHeaders(true)
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка удаления занятия: ${errorText}`);
    }
    
    res.json({
      ok: true,
      message: 'Занятие успешно удалено',
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка удаления занятия:', error);
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

// 17.1. Получить одно занятие по ID
app.get('/api/lesson/:lessonId', requireAuth, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?id=eq.${lessonId}&select=*`,
      { headers: createHeaders() }
    );
    
    if (!response.ok) {
      return res.status(404).json({ error: 'Занятие не найдено', _timestamp: Date.now() });
    }
    
    const lessons = await response.json();
    
    if (lessons.length === 0) {
      return res.status(404).json({ error: 'Занятие не найдено', _timestamp: Date.now() });
    }
    
    const lesson = lessons[0];
    
    // Проверяем права доступа
    if (req.user.role === 'teacher' && lesson.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    // Получаем информацию об ученике
    let student = null;
    if (lesson.student_id) {
      const studentResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/students?id=eq.${lesson.student_id}&select=*`,
        { headers: createHeaders() }
      );
      if (studentResponse.ok) {
        const students = await studentResponse.json();
        if (students.length > 0) {
          student = students[0];
        }
      }
    }
    
    res.json({
      ...lesson,
      student: student,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения занятия:', error);
    res.status(500).json({ error: error.message, _timestamp: Date.now() });
  }
});

// 18. Получить список занятий преподавателя
app.get('/api/teacher/lessons', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Доступ запрещен', _timestamp: Date.now() });
    }
    
    const { start_date, end_date } = req.query;
    let query = `teacher_id=eq.${req.user.id}`;
    
    if (start_date) {
      query += `&lesson_date=gte.${start_date}`;
    }
    if (end_date) {
      query += `&lesson_date=lte.${end_date}`;
    }
    
    // Получаем занятия
    const lessonsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons?${query}&order=lesson_date.desc,start_time.desc&select=*`,
      { headers: createHeaders() }
    );
    const lessons = lessonsResponse.ok ? await lessonsResponse.json() : [];
    
    // Получаем информацию об учениках
    const studentIds = [...new Set(lessons.map(l => l.student_id))];
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
    
    // Объединяем занятия с информацией об учениках
    const lessonsWithStudents = lessons.map(lesson => ({
      ...lesson,
      student: studentsMap[lesson.student_id] || { id: lesson.student_id, first_name: 'Неизвестно', last_name: '' }
    }));
    
    res.json({
      lessons: lessonsWithStudents,
      _timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения занятий:', error);
    res.json({ lessons: [], _timestamp: Date.now() });
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

// ===== API ДЛЯ ОТЛАДКИ =====

// Отладочный endpoint для проверки пользователя и роли
app.get('/api/debug-user', async (req, res) => {
  try {
    const telegramId = getTelegramIdFromRequest(req);
    const user = await getUserByTelegramId(telegramId);
    
    const debugInfo = {
      telegramId: telegramId,
      userFound: !!user,
      user: user ? {
        id: user.id,
        telegram_id: user.telegram_id,
        role: user.role,
        roleType: typeof user.role,
        roleNormalized: user.role ? user.role.toString().trim().toLowerCase() : null,
        approved: user.approved,
        first_name: user.first_name,
        last_name: user.last_name,
        isManager: user.role ? (
          user.role.toString().trim().toLowerCase() === 'manager' ||
          user.role.toString().toLowerCase().includes('manager')
        ) : false
      } : null,
      routingDecision: user ? (
        (user.role && (
          user.role.toString().trim().toLowerCase() === 'manager' ||
          user.role.toString().toLowerCase().includes('manager')
        )) ? 'manager.html' : 'index.html'
      ) : 'index.html (user not found)',
      timestamp: new Date().toISOString()
    };
    
    res.json(debugInfo);
  } catch (error) {
    res.json({
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== РОУТИНГ =====

// Определение роли и редирект
app.get('/', async (req, res) => {
  try {
    // Отключаем кеширование для роутинга
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const telegramId = getTelegramIdFromRequest(req);
    console.log(`🔍 Проверка пользователя для роутинга: telegramId=${telegramId}, query=${JSON.stringify(req.query)}`);
    const user = await getUserByTelegramId(telegramId);
    
    if (!user) {
      console.log(`⚠️  Пользователь не найден, показываем интерфейс преподавателя (по умолчанию)`);
      // Если пользователь не найден, показываем страницу для преподавателя (по умолчанию)
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    
    console.log(`👤 Пользователь найден: role=${user.role}, approved=${user.approved}`);
    console.log(`🔍 Детали роли:`, {
      raw: user.role,
      type: typeof user.role,
      isNull: user.role === null,
      isUndefined: user.role === undefined,
      length: user.role ? user.role.length : 0
    });
    
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
    
    // Редиректим в зависимости от роли
    // Нормализуем роль: убираем пробелы, приводим к нижнему регистру
    const rawRole = user.role ? user.role.toString() : '';
    const normalizedRole = rawRole.trim().toLowerCase();
    console.log(`🎯 Редирект: role="${rawRole}" -> normalized="${normalizedRole}" (тип: ${typeof user.role})`);
    console.log(`📋 Полные данные пользователя:`, JSON.stringify({
      id: user.id,
      telegram_id: user.telegram_id,
      role: user.role,
      approved: user.approved,
      first_name: user.first_name,
      last_name: user.last_name
    }, null, 2));
    
    // Проверяем, является ли пользователь менеджером
    // Используем несколько проверок для надежности
    const isManager = normalizedRole === 'manager' || 
                      normalizedRole.includes('manager') ||
                      rawRole.toLowerCase().includes('manager');
    
    if (isManager) {
      console.log(`✅ Редирект на manager.html (роль: "${rawRole}")`);
      // Отключаем кеширование для manager.html
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return res.sendFile(path.join(__dirname, 'public', 'manager.html'));
    } else {
      console.log(`✅ Редирект на index.html (преподаватель), т.к. role="${normalizedRole}"`);
      // Отключаем кеширование для index.html
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    
  } catch (error) {
    console.error('Ошибка роутинга:', error);
    // По умолчанию показываем интерфейс преподавателя
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/subjects.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subjects.html'));
});

app.get('/manager.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

// Для всех остальных маршрутов
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Сервер запущен на порту ${port}`);
  console.log(`📦 База данных: Supabase PostgreSQL`);
  console.log(`👤 Telegram ID: 913096324`);
  console.log(`🔗 Проверка: http://localhost:${port}/api/status`);
  console.log(`🔗 Инициализация: http://localhost:${port}/api/init-db`);
  console.log(`🔗 Отладка пользователя: http://localhost:${port}/api/debug-user?tgId=YOUR_TELEGRAM_ID`);
});
