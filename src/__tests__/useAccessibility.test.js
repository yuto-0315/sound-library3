import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  useFocus,
  useAnnouncement,
  useKeyboardNavigation,
  useErrorMessages,
  useProgress
} from '../hooks/useAccessibility';

describe('useAccessibility Hooks', () => {
  describe('useFocus', () => {
    test('focuses element when shouldFocus is true', () => {
      const TestComponent = ({ shouldFocus }) => {
        const elementRef = useFocus(shouldFocus);
        return <button ref={elementRef}>Test Button</button>;
      };

      const { rerender } = render(<TestComponent shouldFocus={false} />);
      const button = screen.getByRole('button');
      
      expect(button).not.toHaveFocus();
      
      rerender(<TestComponent shouldFocus={true} />);
      expect(button).toHaveFocus();
    });

    test('does not focus when shouldFocus is false', () => {
      const TestComponent = () => {
        const elementRef = useFocus(false);
        return <button ref={elementRef}>Test Button</button>;
      };

      render(<TestComponent />);
      const button = screen.getByRole('button');
      
      expect(button).not.toHaveFocus();
    });
  });

  describe('useAnnouncement', () => {
    test('creates announcement region with correct attributes', () => {
      const TestComponent = () => {
        const { AnnouncementRegion } = useAnnouncement();
        return <AnnouncementRegion className="test-announcement" />;
      };

      render(<TestComponent />);
      const announcement = document.querySelector('.test-announcement');
      
      expect(announcement).toBeInTheDocument();
      expect(announcement).toHaveAttribute('aria-live', 'polite');
      expect(announcement).toHaveAttribute('aria-atomic', 'true');
      expect(announcement).toHaveClass('sr-only');
    });

    test('announces message with correct priority', () => {
      const TestComponent = () => {
        const { announce, AnnouncementRegion } = useAnnouncement();
        
        return (
          <div>
            <button onClick={() => announce('テストメッセージ', 'assertive')}>
              Announce
            </button>
            <AnnouncementRegion className="test-announcement" />
          </div>
        );
      };

      render(<TestComponent />);
      const button = screen.getByRole('button');
      const announcement = document.querySelector('.test-announcement');
      
      fireEvent.click(button);
      
      expect(announcement).toHaveTextContent('テストメッセージ');
      expect(announcement).toHaveAttribute('aria-live', 'assertive');
    });

    test('announces with default polite priority', () => {
      const TestComponent = () => {
        const { announce, AnnouncementRegion } = useAnnouncement();
        
        return (
          <div>
            <button onClick={() => announce('デフォルトメッセージ')}>
              Announce Default
            </button>
            <AnnouncementRegion className="test-announcement" />
          </div>
        );
      };

      render(<TestComponent />);
      const button = screen.getByRole('button');
      const announcement = document.querySelector('.test-announcement');
      
      fireEvent.click(button);
      
      expect(announcement).toHaveTextContent('デフォルトメッセージ');
      expect(announcement).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('useKeyboardNavigation', () => {
    test('handles keyboard navigation correctly', () => {
      const items = ['item1', 'item2', 'item3'];
      const onActivate = jest.fn();
      
      const TestComponent = () => {
        const { getItemProps } = useKeyboardNavigation(items, { onActivate });
        
        return (
          <div>
            {items.map((item, index) => (
              <button key={item} {...getItemProps(index)}>
                {item}
              </button>
            ))}
          </div>
        );
      };

      render(<TestComponent />);
      const buttons = screen.getAllByRole('button');
      
      // 最初のボタンがタブインデックス0
      expect(buttons[0]).toHaveAttribute('tabindex', '0');
      expect(buttons[1]).toHaveAttribute('tabindex', '-1');
      expect(buttons[2]).toHaveAttribute('tabindex', '-1');
      
      // ArrowRightキーで次へ
      fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
      
      // Enterキーでアクティベート
      fireEvent.keyDown(buttons[0], { key: 'Enter' });
      expect(onActivate).toHaveBeenCalled();
    });

    test('handles vertical orientation', () => {
      const items = ['item1', 'item2'];
      
      const TestComponent = () => {
        const { getItemProps } = useKeyboardNavigation(items, { 
          orientation: 'vertical' 
        });
        
        return (
          <div>
            {items.map((item, index) => (
              <button key={item} {...getItemProps(index)}>
                {item}
              </button>
            ))}
          </div>
        );
      };

      render(<TestComponent />);
      const buttons = screen.getAllByRole('button');
      
      // ArrowDownキーで次へ移動（垂直方向）
      fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
      
      // ArrowUpキーで前へ移動
      fireEvent.keyDown(buttons[0], { key: 'ArrowUp' });
    });
  });

  describe('useErrorMessages', () => {
    test('shows and clears error messages', () => {
      const TestComponent = () => {
        const { showError, clearError, ErrorRegion } = useErrorMessages();
        
        return (
          <div>
            <button onClick={() => showError('エラーメッセージ')}>
              Show Error
            </button>
            <button onClick={clearError}>
              Clear Error
            </button>
            <ErrorRegion className="test-error" />
          </div>
        );
      };

      render(<TestComponent />);
      const showButton = screen.getByText('Show Error');
      const clearButton = screen.getByText('Clear Error');
      const errorRegion = document.querySelector('.test-error');
      
      expect(errorRegion).toHaveAttribute('role', 'alert');
      expect(errorRegion).toHaveAttribute('aria-atomic', 'true');
      expect(errorRegion).toHaveClass('error-message');
      
      fireEvent.click(showButton);
      expect(errorRegion).toHaveTextContent('エラーメッセージ');
      expect(errorRegion).toHaveAttribute('aria-live', 'assertive');
      
      fireEvent.click(clearButton);
      expect(errorRegion).toHaveTextContent('');
      expect(errorRegion).not.toHaveAttribute('aria-live');
    });
  });

  describe('useProgress', () => {
    test('updates progress correctly', () => {
      const TestComponent = () => {
        const { updateProgress, ProgressBar } = useProgress();
        
        return (
          <div>
            <button onClick={() => updateProgress(50, 100, 'テスト')}>
              Update Progress
            </button>
            <ProgressBar className="test-progress" label="テスト進捗" />
          </div>
        );
      };

      render(<TestComponent />);
      const button = screen.getByRole('button');
      const progressBar = document.querySelector('.test-progress');
      
      expect(progressBar).toHaveAttribute('role', 'progressbar');
      expect(progressBar).toHaveAttribute('aria-label', 'テスト進捗');
      expect(progressBar).toHaveAttribute('aria-valuenow', '0');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
      expect(progressBar).toHaveClass('progress-bar');
      
      fireEvent.click(button);
      
      expect(progressBar).toHaveAttribute('aria-valuenow', '50');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
      expect(progressBar).toHaveAttribute('aria-valuetext', 'テスト 50% 完了 (50 / 100)');
    });
  });
});
