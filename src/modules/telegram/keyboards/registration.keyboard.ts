export function registrationKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [
        {
          text: '📱 Telefon raqamni yuborish',
          request_contact: true,
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function removeRegistrationKeyboard(): Record<string, unknown> {
  return { remove_keyboard: true };
}
