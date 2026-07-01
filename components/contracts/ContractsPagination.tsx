import React from 'react';

import { ArrowRightIcon } from './ContractIcons';

interface ContractsPaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const ContractsPagination: React.FC<ContractsPaginationProps> = ({
  currentPage,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
}) => {
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = totalItems === 0 ? 0 : Math.min(currentPage * pageSize, totalItems);

  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <footer className="flex flex-col gap-4 rounded-[1.6rem] border border-slate-200 bg-white px-5 py-4 shadow-[0_20px_60px_-50px_rgba(15,23,42,0.35)] md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold text-slate-900">
          Exibindo {start}-{end} de {totalItems} contratos
        </p>
        <p className="mt-1 text-sm text-slate-500">Navegue entre páginas sem perder os filtros ativos.</p>
      </div>

      <div className="flex items-center gap-2 self-start md:self-auto">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-brand-100 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowRightIcon className="h-4 w-4 rotate-180" />
          Anterior
        </button>

        <div className="flex items-center gap-2">
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border text-sm font-semibold transition-all duration-200 ${
                pageNumber === currentPage
                  ? 'border-brand-100 bg-brand-50 text-brand-700 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-brand-100 hover:bg-slate-50'
              }`}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
            >
              {pageNumber}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-brand-100 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Próxima
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </footer>
  );
};
