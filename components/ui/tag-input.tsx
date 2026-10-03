"use client"

import { useState, KeyboardEvent } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface TagInputProps {
    value: string[] // Array of tags
    onChange: (tags: string[]) => void
    placeholder?: string
    className?: string
    // Keywords are lowercased and split on commas; sentences (public replies,
    // message variations) keep their casing and commas.
    sentences?: boolean
}

export function TagInput({ value, onChange, placeholder, className, sentences = false }: TagInputProps) {
    const [inputValue, setInputValue] = useState("")

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || (e.key === "," && !sentences)) {
            e.preventDefault()
            addTag()
        } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
            // Remove last tag on backspace if input is empty
            removeTag(value.length - 1)
        }
    }

    const addTag = () => {
        const trimmed = sentences ? inputValue.trim() : inputValue.trim().toLowerCase()
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed])
            setInputValue("")
        }
    }

    const removeTag = (index: number) => {
        onChange(value.filter((_, i) => i !== index))
    }

    return (
        <div className={`flex flex-wrap gap-2 p-2 rounded-lg border border-white/10 bg-black/20 focus-within:border-[#ffe14d]/50 transition-all ${className}`}>
            {value.map((tag, index) => (
                <Badge
                    key={index}
                    variant="secondary"
                    className="bg-[#ffe14d]/10 text-[#ffe14d] border-[#ffe14d]/25 hover:bg-[#ffe14d]/20 pl-2.5 pr-1 py-1 text-xs font-medium gap-1.5"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() => removeTag(index)}
                        className="hover:bg-purple-500/40 rounded-sm p-0.5 transition-colors"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </Badge>
            ))}
            <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={addTag}
                placeholder={value.length === 0 ? placeholder : ""}
                className="flex-1 min-w-[120px] border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm px-1"
            />
        </div>
    )
}
