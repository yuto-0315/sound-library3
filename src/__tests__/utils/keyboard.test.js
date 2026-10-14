import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { focusNextFieldOnEnter, isEnterKey, isImeComposing } from '../../utils/keyboard';

describe('isEnterKey / isImeComposing', () => {
  test('日本語入力の確定の Enter（keyCode 229・isComposing）は Enter として扱わない', () => {
    expect(isEnterKey({ key: 'Enter', keyCode: 13 })).toBe(true);
    expect(isEnterKey({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(isEnterKey({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false);
    expect(isEnterKey({ key: 'a' })).toBe(false);
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });
});

describe('focusNextFieldOnEnter', () => {
  const Form = ({ onSubmit }) => (
    <form onSubmit={onSubmit}>
      <input aria-label="1つめ" onKeyDown={focusNextFieldOnEnter} />
      <input aria-label="とばす" type="radio" onKeyDown={focusNextFieldOnEnter} />
      <input aria-label="使えない" disabled onKeyDown={focusNextFieldOnEnter} />
      <input aria-label="2つめ" type="search" onKeyDown={focusNextFieldOnEnter} />
      <input aria-label="さいご" onKeyDown={focusNextFieldOnEnter} />
      <button type="submit">送る</button>
    </form>
  );

  test('Enter で次の入力欄へ移り（ラジオボタン・使えない欄はとばす）、送らない', () => {
    const onSubmit = jest.fn((event) => event.preventDefault());
    render(<Form onSubmit={onSubmit} />);
    const first = screen.getByLabelText('1つめ');
    first.focus();
    const enter = createEvent.keyDown(first, { key: 'Enter', keyCode: 13 });
    fireEvent(first, enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(screen.getByLabelText('2つめ')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('2つめ'), { key: 'Enter', keyCode: 13 });
    expect(screen.getByLabelText('さいご')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('最後の欄ではキーボードを閉じる（フォーカスを外す）', () => {
    render(<Form onSubmit={jest.fn()} />);
    const last = screen.getByLabelText('さいご');
    last.focus();
    fireEvent.keyDown(last, { key: 'Enter', keyCode: 13 });
    expect(last).not.toHaveFocus();
  });

  test('日本語入力の確定の Enter と、Enter 以外のキーでは何もしない', () => {
    render(<Form onSubmit={jest.fn()} />);
    const first = screen.getByLabelText('1つめ');
    first.focus();
    const imeEnter = createEvent.keyDown(first, { key: 'Enter', keyCode: 229 });
    fireEvent(first, imeEnter);
    expect(imeEnter.defaultPrevented).toBe(false);
    fireEvent.keyDown(first, { key: 'a' });
    expect(first).toHaveFocus();
  });

  test('フォームの外の欄では何もしない', () => {
    render(<input aria-label="ひとり" onKeyDown={focusNextFieldOnEnter} />);
    const input = screen.getByLabelText('ひとり');
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(input).toHaveFocus();
  });
});
