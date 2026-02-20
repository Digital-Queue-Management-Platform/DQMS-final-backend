import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding SLT bill data...');

  // Sample SLT bill data
  const billsData = [
    {
      telephoneNumber: '0112345678',
      accountName: 'John Silva',
      accountAddress: '123, Galle Road, Colombo 03',
      currentBill: 2500.00,
      dueDate: new Date('2026-03-15'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0417654321',
      accountName: 'Nimal Perera',
      accountAddress: '456, Kandy Road, Kandy',
      currentBill: 3200.50,
      dueDate: new Date('2026-03-10'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0815551234',
      accountName: 'Saman Fernando',
      accountAddress: '789, Main Street, Negombo',
      currentBill: 1850.75,
      dueDate: new Date('2026-03-20'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0118887777',
      accountName: 'Kamala Jayawardena',
      accountAddress: '321, Lake Road, Matara',
      currentBill: 4100.00,
      dueDate: new Date('2026-03-05'),
      status: 'overdue',
    },
    {
      telephoneNumber: '0113334444',
      accountName: 'Ruwan Wickramasinghe',
      accountAddress: '654, Beach Road, Galle',
      currentBill: 2890.25,
      dueDate: new Date('2026-03-18'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0116669999',
      accountName: 'Amara De Silva',
      accountAddress: '987, Temple Road, Anuradhapura',
      currentBill: 1500.00,
      dueDate: new Date('2026-02-28'),
      status: 'paid',
      lastPaymentDate: new Date('2026-02-25'),
    },
    {
      telephoneNumber: '0114445555',
      accountName: 'Tharindu Rajapaksha',
      accountAddress: '147, Hill Street, Nuwara Eliya',
      currentBill: 3750.50,
      dueDate: new Date('2026-03-12'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0112223333',
      accountName: 'Dilini Kumari',
      accountAddress: '258, Station Road, Jaffna',
      currentBill: 2100.00,
      dueDate: new Date('2026-03-22'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0119998888',
      accountName: 'Pradeep Mendis',
      accountAddress: '369, Park Avenue, Ratnapura',
      currentBill: 5200.75,
      dueDate: new Date('2026-03-08'),
      status: 'unpaid',
    },
    {
      telephoneNumber: '0115557777',
      accountName: 'Sanduni Wijesekara',
      accountAddress: '741, River View, Kurunegala',
      currentBill: 2650.50,
      dueDate: new Date('2026-03-25'),
      status: 'unpaid',
    },
  ];

  // Upsert bills (create or update if exists)
  for (const bill of billsData) {
    await prisma.sltBill.upsert({
      where: { telephoneNumber: bill.telephoneNumber },
      update: {
        accountName: bill.accountName,
        accountAddress: bill.accountAddress,
        currentBill: bill.currentBill,
        dueDate: bill.dueDate,
        status: bill.status,
        lastPaymentDate: bill.lastPaymentDate,
      },
      create: bill,
    });
    console.log(`✓ Created/Updated bill for ${bill.telephoneNumber} - ${bill.accountName}`);
  }

  console.log(`\n✅ Successfully seeded ${billsData.length} SLT bills`);
}

main()
  .catch((e) => {
    console.error('Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
