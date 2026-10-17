import { Wordmark } from './wordmark'

// Letterforms from Buffer's official wordmark: https://buffer.com/press
function BufferWordmark() {
  return (
    <span className="buffer-wordmark">
      <span className="sr-only">Buffer</span>
      <svg viewBox="38 5 94 27" aria-hidden="true" fill="currentColor">
        <path d="M86.068 12.909v-.175c0-2.421 1.425-3.195 3.823-3.02V5.294c-5.746-.35-8.47 2.521-8.47 7.439v.175h-2.598v4.418h3.598v13.38h4.647v-13.38h5.346v13.38h4.647v-13.38h3.823v-4.418h-3.823v-.175c0-2.421 1.4-3.195 3.823-3.02V5.294c-5.746-.35-8.47 2.521-8.47 7.439v.175h-5.346Z"></path>
        <path
          fillRule="evenodd"
          d="M53.588 17.751c1.474-1.173 2.374-2.845 2.374-4.992 0-4.169-3.398-7.014-7.67-7.014h-9.92v24.912h10.72c4.371 0 7.87-2.946 7.87-7.214-.05-2.571-1.35-4.543-3.374-5.692Zm-5.271-7.388c1.599 0 2.698 1.173 2.698 2.745 0 1.573-1.15 2.746-2.698 2.746h-4.972v-5.491h4.972Zm.75 15.726h-5.722v-5.866h5.721c1.7 0 2.923 1.248 2.923 2.92 0 1.698-1.224 2.946-2.923 2.946Z"
        ></path>
        <path d="M71.451 12.883v9.61c0 3.096-1.698 4.419-3.972 4.419-2.099 0-3.573-1.248-3.573-3.67V12.883H59.26v10.933c0 4.743 2.973 7.364 6.82 7.364 2.424 0 4.298-.898 5.348-2.496v1.997h4.647V12.883H71.45Z"></path>
        <path
          fillRule="evenodd"
          d="M119.147 23.667h-13.592c.675 2.346 2.623 3.345 5.047 3.345 1.824 0 3.273-.749 4.047-1.773l3.748 2.122c-1.674 2.422-4.372 3.82-7.845 3.82-6.046 0-9.869-4.094-9.869-9.411 0-5.317 3.848-9.41 9.519-9.41 5.322 0 9.119 4.168 9.119 9.41 0 .699-.075 1.298-.174 1.897Zm-8.945-7.14c-2.498 0-4.197 1.324-4.722 3.595h9.194c-.574-2.57-2.523-3.594-4.472-3.594Z"
        ></path>
        <path d="M126.044 15.954v-3.07h-4.648v17.798h4.648V22.17c0-3.745 3.048-4.818 5.471-4.519v-5.117c-2.273 0-4.547.999-5.471 3.42Z"></path>
      </svg>
    </span>
  )
}

export function BrandText({ children }: { children: string }) {
  return children.split(/\b(Dispatchlet|Buffer)\b/).map((part, index) =>
    part === 'Dispatchlet' ? (
      <span key={index} className="inline-wordmark">
        <Wordmark inline />
      </span>
    ) : part === 'Buffer' ? (
      <BufferWordmark key={index} />
    ) : (
      part
    ),
  )
}
