import re

known_errors = {
    'Продолжение следует...',
    '.',
    '...',
    'Субтитры сделал DimaTorzok',
    '*',
    'おやすみなさい。',
    '*sad breathing*',
    '*mimics*',
    '- Mm.',
    '- Oh.',
    '- Yeah.',
    'И...',
    'uh',
    'Ну...',
    '-',
}


asterisk_pattern = re.compile(r'^\*.*\*$')

remove_if_lonely = {
    'Thank you.',
    "I'm sorry.",
    'Okay.',
    'All right.',
    'Спасибо.',
    'Дякую.',
    'Gracias.',
    'Obrigado.',
    'Dziękuję.',
}
