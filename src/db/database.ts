import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Project {
  id: string;
  name: string;
  color: string;
  description: string;
  archived: boolean;
  createdAt: string;
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  estimatedMinutes?: number;
  actualMinutes: number;
  tags: string[];
  completedAt?: string;
  order: number;
  createdAt: string;
}

export interface FocusSession {
  id: string;
  taskId?: string;
  taskTitle?: string;
  durationMinutes: number;
  type: 'focus' | 'short_break' | 'long_break';
  notes?: string;
  completed: boolean;
  timestamp: string;
}

export interface DailyLog {
  id: string;
  date: string; // YYYY-MM-DD
  intentions: string[];
  retro: string;
  energyRating: number; // 1-5
  focusRating: number;  // 1-5
  notes: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseSchema {
  projects: Project[];
  tasks: Task[];
  focusSessions: FocusSession[];
  dailyLogs: DailyLog[];
  notes: Note[];
}

export class Database {
  private data: DatabaseSchema = {
    projects: [],
    tasks: [],
    focusSessions: [],
    dailyLogs: [],
    notes: [],
  };

  private filePath: string;
  private initialized = false;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'database.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.data = {
        projects: parsed.projects || [],
        tasks: parsed.tasks || [],
        focusSessions: parsed.focusSessions || [],
        dailyLogs: parsed.dailyLogs || [],
        notes: parsed.notes || [],
      };
    } catch {
      // Initialize with seed data for a warm, ready-to-use first experience
      this.seedInitialData();
      await this.persist();
    }
    this.initialized = true;
  }

  async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempFile = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
    await fs.rename(tempFile, this.filePath);
  }

  private seedInitialData() {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const defaultProject: Project = {
      id: crypto.randomUUID(),
      name: 'General',
      color: '#4f46e5',
      description: 'Default project for everyday tasks and focus',
      archived: false,
      createdAt: now,
    };

    const initialTasks: Task[] = [
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Welcome to HeyWork! Plan your day ☕',
        description: 'Set your morning intention, pick your top 3 tasks, and start a focus session.',
        status: 'todo',
        priority: 'high',
        dueDate: today,
        estimatedMinutes: 25,
        actualMinutes: 0,
        tags: ['starter', 'planning'],
        order: 0,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Try the 25-minute Pomodoro focus timer',
        description: 'Click on the Focus tab, turn on gentle rain or brown noise, and enter flow state.',
        status: 'todo',
        priority: 'medium',
        dueDate: today,
        estimatedMinutes: 25,
        actualMinutes: 0,
        tags: ['focus'],
        order: 1,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        projectId: defaultProject.id,
        title: 'Review today in the Evening Retrospective',
        description: 'Log your 3 wins, reflections, and rate your focus & energy.',
        status: 'backlog',
        priority: 'low',
        dueDate: today,
        estimatedMinutes: 10,
        actualMinutes: 0,
        tags: ['retro'],
        order: 2,
        createdAt: now,
      },
    ];

    const initialNote: Note = {
      id: crypto.randomUUID(),
      title: 'Quick Scratchpad & Guidelines',
      content: `# Welcome to HeyWork\n\n*A calm, distraction-free companion for deep work.*\n\n### Core Workflows\n- **Today**: Time-block and execute your high-priority items.\n- **Focus**: Native flow timer with ambient sounds (synthesized live via Web Audio, zero external assets).\n- **Board**: Kanban view to organize work into Backlog, Todo, In Progress, and Done.\n- **Journal**: Intentional morning planning and mindful evening reflections.\n- **Insights**: Canvas-based visual heatmaps and streaks to track consistency over time.`,
      tags: ['guide', 'readme'],
      pinned: true,
      createdAt: now,
      updatedAt: now,
    };

    const initialLog: DailyLog = {
      id: crypto.randomUUID(),
      date: today,
      intentions: [
        'Complete today’s top deep work session',
        'Review priorities without distractions',
        'Reflect on progress in the evening',
      ],
      retro: 'Excited to start fresh with a calm, focused workspace.',
      energyRating: 4,
      focusRating: 4,
      notes: 'Initial day setup in HeyWork.',
      updatedAt: now,
    };

    this.data.projects.push(defaultProject);
    this.data.tasks.push(...initialTasks);
    this.data.notes.push(initialNote);
    this.data.dailyLogs.push(initialLog);
  }

  // ── Projects CRUD ──
  getProjects(includeArchived = false): Project[] {
    if (includeArchived) return [...this.data.projects];
    return this.data.projects.filter(p => !p.archived);
  }

  getProject(id: string): Project | undefined {
    return this.data.projects.find(p => p.id === id);
  }

  createProject(item: Omit<Project, 'id' | 'createdAt'>): Project {
    const project: Project = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.data.projects.push(project);
    return project;
  }

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const idx = this.data.projects.findIndex(p => p.id === id);
    if (idx === -1) return null;
    this.data.projects[idx] = { ...this.data.projects[idx], ...updates };
    return this.data.projects[idx];
  }

  deleteProject(id: string): boolean {
    const idx = this.data.projects.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.data.projects.splice(idx, 1);
    // Unlink tasks from deleted project
    for (const task of this.data.tasks) {
      if (task.projectId === id) {
        delete task.projectId;
      }
    }
    return true;
  }

  // ── Tasks CRUD ──
  getTasks(filters?: { status?: TaskStatus; projectId?: string; tag?: string }): Task[] {
    let result = [...this.data.tasks];
    if (filters?.status) result = result.filter(t => t.status === filters.status);
    if (filters?.projectId) result = result.filter(t => t.projectId === filters.projectId);
    if (filters?.tag) result = result.filter(t => t.tags.includes(filters.tag!));
    return result.sort((a, b) => a.order - b.order);
  }

  getTask(id: string): Task | undefined {
    return this.data.tasks.find(t => t.id === id);
  }

  createTask(item: Omit<Task, 'id' | 'actualMinutes' | 'order' | 'createdAt'>): Task {
    const now = new Date().toISOString();
    const currentMaxOrder = this.data.tasks.reduce((max, t) => Math.max(max, t.order), -1);
    const task: Task = {
      ...item,
      id: crypto.randomUUID(),
      actualMinutes: 0,
      order: currentMaxOrder + 1,
      createdAt: now,
      completedAt: item.status === 'done' ? now : undefined,
    };
    this.data.tasks.push(task);
    return task;
  }

  updateTask(id: string, updates: Partial<Task>): Task | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const prevStatus = this.data.tasks[idx].status;
    const task = { ...this.data.tasks[idx], ...updates };
    if (updates.status === 'done' && prevStatus !== 'done') {
      task.completedAt = new Date().toISOString();
    } else if (updates.status && updates.status !== 'done') {
      delete task.completedAt;
    }
    this.data.tasks[idx] = task;
    return task;
  }

  deleteTask(id: string): boolean {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    return true;
  }

  reorderTasks(taskIds: string[]): boolean {
    taskIds.forEach((id, index) => {
      const t = this.data.tasks.find(task => task.id === id);
      if (t) t.order = index;
    });
    return true;
  }

  // ── Focus Sessions ──
  getFocusSessions(limit = 100): FocusSession[] {
    return [...this.data.focusSessions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  logFocusSession(session: Omit<FocusSession, 'id' | 'timestamp'>): FocusSession {
    const newSession: FocusSession = {
      ...session,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.data.focusSessions.push(newSession);

    // If attached to a task, credit the actual minutes
    if (session.taskId && session.completed && session.type === 'focus') {
      const task = this.data.tasks.find(t => t.id === session.taskId);
      if (task) {
        task.actualMinutes = (task.actualMinutes || 0) + session.durationMinutes;
      }
    }
    return newSession;
  }

  // ── Daily Logs ──
  getDailyLog(date: string): DailyLog | undefined {
    return this.data.dailyLogs.find(l => l.date === date);
  }

  getDailyLogs(limit = 30): DailyLog[] {
    return [...this.data.dailyLogs]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  upsertDailyLog(log: Omit<DailyLog, 'id' | 'updatedAt'>): DailyLog {
    const now = new Date().toISOString();
    const existing = this.data.dailyLogs.find(l => l.date === log.date);
    if (existing) {
      Object.assign(existing, {
        intentions: log.intentions,
        retro: log.retro,
        energyRating: log.energyRating,
        focusRating: log.focusRating,
        notes: log.notes,
        updatedAt: now,
      });
      return existing;
    }
    const newLog: DailyLog = {
      ...log,
      id: crypto.randomUUID(),
      updatedAt: now,
    };
    this.data.dailyLogs.push(newLog);
    return newLog;
  }

  // ── Notes ──
  getNotes(tag?: string, query?: string): Note[] {
    let result = [...this.data.notes];
    if (tag) result = result.filter(n => n.tags.includes(tag));
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }
    return result.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  getNote(id: string): Note | undefined {
    return this.data.notes.find(n => n.id === id);
  }

  createNote(item: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Note {
    const now = new Date().toISOString();
    const note: Note = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.data.notes.push(note);
    return note;
  }

  updateNote(id: string, updates: Partial<Note>): Note | null {
    const idx = this.data.notes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    this.data.notes[idx] = {
      ...this.data.notes[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return this.data.notes[idx];
  }

  deleteNote(id: string): boolean {
    const idx = this.data.notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    this.data.notes.splice(idx, 1);
    return true;
  }

  // ── Dashboard / Insights Summary ──
  getDashboardSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = this.data.tasks.filter(t => t.dueDate === today || t.status === 'in_progress');
    const completedToday = this.data.tasks.filter(t => t.completedAt?.startsWith(today)).length;

    // Focus minutes today
    const focusTodayMinutes = this.data.focusSessions
      .filter(s => s.completed && s.type === 'focus' && s.timestamp.startsWith(today))
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    // Calculate daily streak (days with focus >= 1 session or at least 1 completed task)
    const activeDates = new Set<string>();
    this.data.focusSessions
      .filter(s => s.completed && s.type === 'focus')
      .forEach(s => activeDates.add(s.timestamp.slice(0, 10)));
    this.data.tasks
      .filter(t => t.completedAt)
      .forEach(t => activeDates.add(t.completedAt!.slice(0, 10)));

    let streak = 0;
    const checkDate = new Date();
    // Allow checking starting today, or yesterday if nothing done yet today
    const checkStr = checkDate.toISOString().slice(0, 10);
    if (!activeDates.has(checkStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }
    while (true) {
      const dStr = checkDate.toISOString().slice(0, 10);
      if (activeDates.has(dStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Weekly focus time by last 7 days
    const last7Days: { date: string; day: string; focusMinutes: number; completedTasks: number }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().slice(0, 10);
      const mins = this.data.focusSessions
        .filter(s => s.completed && s.type === 'focus' && s.timestamp.startsWith(dStr))
        .reduce((sum, s) => sum + s.durationMinutes, 0);
      const tasksCount = this.data.tasks
        .filter(t => t.completedAt?.startsWith(dStr))
        .length;
      last7Days.push({
        date: dStr,
        day: dayNames[d.getDay()],
        focusMinutes: mins,
        completedTasks: tasksCount,
      });
    }

    // Task counts by status
    const statusCounts = {
      backlog: this.data.tasks.filter(t => t.status === 'backlog').length,
      todo: this.data.tasks.filter(t => t.status === 'todo').length,
      in_progress: this.data.tasks.filter(t => t.status === 'in_progress').length,
      done: this.data.tasks.filter(t => t.status === 'done').length,
    };

    return {
      today,
      todayTasks,
      completedToday,
      focusTodayMinutes,
      streak,
      last7Days,
      statusCounts,
      totalProjects: this.data.projects.filter(p => !p.archived).length,
      totalNotes: this.data.notes.length,
      todayLog: this.getDailyLog(today) || null,
    };
  }
}

export const db = new Database();
