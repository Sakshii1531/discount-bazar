import { render, screen, fireEvent } from '@testing-library/react';
import EmptyState from '@shared/components/EmptyState';
import ErrorBoundary from '@shared/components/ErrorBoundary';
import Button from '@shared/components/ui/Button';
import Pagination from '@shared/components/ui/Pagination';

describe('EmptyState', () => {
  it('renders title, description and optional action', () => {
    render(<EmptyState title="No orders" description="Place your first order" action={<button>Shop</button>} />);
    expect(screen.getByRole('heading', { name: 'No orders' })).toBeInTheDocument();
    expect(screen.getByText('Place your first order')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shop' })).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  const Boom = () => {
    throw new Error('Kaboom');
  };

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('shows a recovery screen with the error message', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Kaboom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Home/ })).toHaveAttribute('href', '/');
    spy.mockRestore();
  });
});

describe('Button', () => {
  it('fires clicks and disables while loading', () => {
    const onClick = jest.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} isLoading>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('Pagination', () => {
  it('hides itself for a single page without size picker', () => {
    const { container } = render(<Pagination page={1} totalPages={1} total={5} pageSize={10} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows range and navigates', () => {
    const onPageChange = jest.fn();
    render(<Pagination page={2} totalPages={3} total={25} pageSize={10} onPageChange={onPageChange} />);
    expect(screen.getByText('11-20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it('disables edges and changes page size', () => {
    const onPageSizeChange = jest.fn();
    render(
      <Pagination
        page={1}
        totalPages={1}
        total={3}
        pageSize={10}
        onPageChange={() => {}}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '25' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });
});
