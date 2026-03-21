import { Income, Expense } from '../types';

const INCOME_DB_KEY = 'axsys_income_db_v2';
const EXPENSE_DB_KEY = 'axsys_expense_db_v2';

export const getIncomes = (): Income[] => {
    const stored = localStorage.getItem(INCOME_DB_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return [];
};

export const saveIncome = (income: Income): void => {
    const incomes = getIncomes();
    const index = incomes.findIndex(i => i.id === income.id);
    if (index !== -1) {
        incomes[index] = income;
    } else {
        incomes.push(income);
    }
    localStorage.setItem(INCOME_DB_KEY, JSON.stringify(incomes));
};

export const deleteIncome = (id: string): void => {
    const incomes = getIncomes();
    const filtered = incomes.filter(i => i.id !== id);
    localStorage.setItem(INCOME_DB_KEY, JSON.stringify(filtered));
};

export const getExpenses = (): Expense[] => {
    const stored = localStorage.getItem(EXPENSE_DB_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return [];
};

export const saveExpense = (expense: Expense): void => {
    const expenses = getExpenses();
    const index = expenses.findIndex(e => e.id === expense.id);
    if (index !== -1) {
        expenses[index] = expense;
    } else {
        expenses.push(expense);
    }
    localStorage.setItem(EXPENSE_DB_KEY, JSON.stringify(expenses));
};

export const deleteExpense = (id: string): void => {
    const expenses = getExpenses();
    const filtered = expenses.filter(e => e.id !== id);
    localStorage.setItem(EXPENSE_DB_KEY, JSON.stringify(filtered));
};
