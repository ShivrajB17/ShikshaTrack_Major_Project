import '../src/config/env.js';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/db.js';

async function main() {
  console.log('🌱 Starting ShikshaTrack database seeding...');

  // 1. Create or upsert school
  const school = await prisma.school.upsert({
    where: { code: 'GHSS-001' },
    update: {},
    create: {
      name: 'Government Higher Secondary School',
      code: 'GHSS-001',
      address: 'Rural Education Zone, Block 4, Sehore, Madhya Pradesh',
      contactEmail: 'admin@shikshatrack.in',
      contactPhone: '+91-9876543210',
    },
  });
  console.log(`🏫 School verified: ${school.name} (${school.id})`);

  // 2. Create Admin user
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@shikshatrack.in' },
    update: { passwordHash: adminPasswordHash, active: true },
    create: {
      name: 'Institutional Administrator',
      email: 'admin@shikshatrack.in',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      schoolId: school.id,
      active: true,
    },
  });
  console.log(`👤 Admin user seeded: ${admin.email}`);

  // 3. Create Teacher user
  const teacherPasswordHash = await bcrypt.hash('teacher123', 10);
  const teacher = await prisma.user.upsert({
    where: { email: 'ramesh.teacher@shikshatrack.in' },
    update: { passwordHash: teacherPasswordHash, active: true },
    create: {
      name: 'Ramesh Kumar',
      email: 'ramesh.teacher@shikshatrack.in',
      passwordHash: teacherPasswordHash,
      role: 'TEACHER',
      schoolId: school.id,
      active: true,
    },
  });
  console.log(`👨‍🏫 Teacher user seeded: ${teacher.email}`);

  // 4. Create Classes
  const class8A = await prisma.class.upsert({
    where: { id: 'class-8a-default' },
    update: {},
    create: {
      id: 'class-8a-default',
      name: 'Class 8',
      section: 'A',
      academicYear: '2026-2027',
      schoolId: school.id,
    },
  });

  const class9A = await prisma.class.upsert({
    where: { id: 'class-9a-default' },
    update: {},
    create: {
      id: 'class-9a-default',
      name: 'Class 9',
      section: 'A',
      academicYear: '2026-2027',
      schoolId: school.id,
    },
  });

  // Assign teacher to Class 8-A
  await prisma.teacherAssignment.upsert({
    where: {
      teacherId_classId: {
        teacherId: teacher.id,
        classId: class8A.id,
      },
    },
    update: {},
    create: {
      teacherId: teacher.id,
      classId: class8A.id,
      isClassTeacher: true,
    },
  });

  // 5. Create Sample Students for Class 8-A
  const studentsData = [
    { name: 'Aarav Sharma', admissionNumber: 'ST-2026-001', rollNumber: '1', gender: 'MALE' },
    { name: 'Diya Patel', admissionNumber: 'ST-2026-002', rollNumber: '2', gender: 'FEMALE' },
    { name: 'Rohan Verma', admissionNumber: 'ST-2026-003', rollNumber: '3', gender: 'MALE' },
    { name: 'Ananya Gupta', admissionNumber: 'ST-2026-004', rollNumber: '4', gender: 'FEMALE' },
    { name: 'Kabir Singh', admissionNumber: 'ST-2026-005', rollNumber: '5', gender: 'MALE' },
  ];

  for (const s of studentsData) {
    await prisma.student.upsert({
      where: {
        schoolId_admissionNumber: {
          schoolId: school.id,
          admissionNumber: s.admissionNumber,
        },
      },
      update: {},
      create: {
        name: s.name,
        admissionNumber: s.admissionNumber,
        rollNumber: s.rollNumber,
        gender: s.gender,
        classId: class8A.id,
        schoolId: school.id,
        active: true,
      },
    });
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
