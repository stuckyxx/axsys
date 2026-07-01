import type { Expense, Income, User } from '../types.ts';
import { readCompanyScopedValue, writeCompanyScopedValue } from './storageScope.ts';

const INCOME_DB_KEY = 'axsys_income_db_v2';
const EXPENSE_DB_KEY = 'axsys_expense_db_v2';

export const getIncomes = (
    user?: Pick<User, 'companyId'> | null,
): Income[] => {
    return readCompanyScopedValue(INCOME_DB_KEY, [], user);
};

export const saveIncome = (
    income: Income,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const incomes = getIncomes(user);
    const index = incomes.findIndex(i => i.id === income.id);
    if (index !== -1) {
        incomes[index] = income;
    } else {
        incomes.push(income);
    }
    writeCompanyScopedValue(INCOME_DB_KEY, incomes, user);
};

export const deleteIncome = (
    id: string,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const incomes = getIncomes(user);
    const filtered = incomes.filter(i => i.id !== id);
    writeCompanyScopedValue(INCOME_DB_KEY, filtered, user);
};

export const getExpenses = (
    user?: Pick<User, 'companyId'> | null,
): Expense[] => {
    return readCompanyScopedValue(EXPENSE_DB_KEY, [], user);
};

export const saveExpense = (
    expense: Expense,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const expenses = getExpenses(user);
    const index = expenses.findIndex(e => e.id === expense.id);
    if (index !== -1) {
        expenses[index] = expense;
    } else {
        expenses.push(expense);
    }
    writeCompanyScopedValue(EXPENSE_DB_KEY, expenses, user);
};

export const deleteExpense = (
    id: string,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const expenses = getExpenses(user);
    const filtered = expenses.filter(e => e.id !== id);
    writeCompanyScopedValue(EXPENSE_DB_KEY, filtered, user);
};
